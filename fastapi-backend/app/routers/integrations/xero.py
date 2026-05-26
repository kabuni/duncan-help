"""
Xero integration: xero-auth, xero-callback, xero-api, xero-webhook, sync-xero-data
Tables: xero_tokens, xero_invoices, xero_contacts, company_integrations, sync_logs
"""
import uuid
import base64
import logging
from typing import Optional
from datetime import datetime, timezone

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_admin
from app.db_pool import get_connection
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["xero"])

XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize"
XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_API_BASE = "https://api.xero.com/api.xro/2.0"
XERO_CONNECTIONS_URL = "https://api.xero.com/connections"
XERO_SCOPES = (
    "openid profile email accounting.transactions accounting.contacts.read "
    "accounting.reports.profitandloss.read accounting.reports.balancesheet.read "
    "accounting.reports.aged.read offline_access"
)


class XeroActionRequest(BaseModel):
    action: str
    invoice_id: Optional[str] = None
    contact_id: Optional[str] = None
    report_id: Optional[str] = None
    modified_after: Optional[str] = None
    invoice: Optional[dict] = None
    bank_transaction: Optional[dict] = None


async def _get_xero_token(conn: asyncpg.Connection) -> dict:
    row = await conn.fetchrow("SELECT * FROM xero_tokens ORDER BY created_at DESC LIMIT 1")
    if not row:
        raise HTTPException(status_code=400, detail="Xero not connected")
    return dict(row)


async def _refresh_xero_token(conn: asyncpg.Connection, token_row: dict) -> str:
    expiry = token_row.get("token_expiry")
    if expiry:
        if isinstance(expiry, str):
            expiry = datetime.fromisoformat(expiry)
        if expiry.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc).replace(second=0):
            return token_row["access_token"]

    client_id = settings.XERO_CLIENT_ID
    client_secret = settings.XERO_CLIENT_SECRET
    basic_auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            XERO_TOKEN_URL,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": f"Basic {basic_auth}",
            },
            data={
                "refresh_token": token_row["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
    if not resp.is_success:
        raise HTTPException(status_code=400, detail=f"Xero token refresh failed: {resp.text[:200]}")

    tokens = resp.json()
    new_expiry = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + tokens["expires_in"], tz=timezone.utc
    )
    try:
        await conn.execute(
            """UPDATE xero_tokens
               SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_expiry = $3
               WHERE id = $4""",
            tokens["access_token"],
            tokens.get("refresh_token"),
            new_expiry,
            token_row["id"],
        )
    except Exception as e:
        logger.warning(f"Could not update Xero token: {e}")
    return tokens["access_token"]


@router.get("/xero-auth")
async def xero_auth(current_user: dict = Depends(require_admin)):
    client_id = settings.XERO_CLIENT_ID
    if not client_id:
        raise HTTPException(status_code=503, detail="Xero not configured (XERO_CLIENT_ID missing)")

    redirect_uri = f"{settings.APP_URL}/xero-callback"
    auth_url = (
        f"{XERO_AUTH_URL}"
        f"?response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={XERO_SCOPES.replace(' ', '%20')}"
        f"&state={uuid.uuid4()}"
    )
    return {"url": auth_url}


@router.get("/xero-callback")
async def xero_callback(
    code: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    app_url = settings.APP_URL
    if error or not code:
        return RedirectResponse(f"{app_url}/integrations?error={error or 'no_code'}")

    client_id = settings.XERO_CLIENT_ID
    client_secret = settings.XERO_CLIENT_SECRET
    basic_auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    redirect_uri = f"{app_url}/xero-callback"

    async with httpx.AsyncClient(timeout=30) as client:
        token_resp = await client.post(
            XERO_TOKEN_URL,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": f"Basic {basic_auth}",
            },
            data={"code": code, "redirect_uri": redirect_uri, "grant_type": "authorization_code"},
        )
    if not token_resp.is_success:
        logger.error(f"Xero token exchange failed: {token_resp.text}")
        return RedirectResponse(f"{app_url}/integrations?error=token_exchange_failed")

    tokens = token_resp.json()
    expiry = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + tokens["expires_in"], tz=timezone.utc
    )

    tenant_id = None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            conn_resp = await client.get(
                XERO_CONNECTIONS_URL,
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
        if conn_resp.is_success:
            connections = conn_resp.json()
            if connections:
                tenant_id = connections[0].get("tenantId")
    except Exception as e:
        logger.warning(f"Failed to get Xero tenant: {e}")

    try:
        await conn.execute("DELETE FROM xero_tokens WHERE id != $1", "00000000-0000-0000-0000-000000000000")
        await conn.execute(
            """INSERT INTO xero_tokens (id, access_token, refresh_token, token_expiry, tenant_id, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())""",
            str(uuid.uuid4()), tokens["access_token"], tokens["refresh_token"], expiry, tenant_id,
        )
        await conn.execute(
            """INSERT INTO company_integrations (id, integration_id, status, last_sync, created_at, updated_at)
               VALUES ($1, 'xero', 'connected', NOW(), NOW(), NOW())
               ON CONFLICT (integration_id) DO UPDATE SET status = 'connected', last_sync = NOW(), updated_at = NOW()""",
            str(uuid.uuid4()),
        )
    except Exception as e:
        logger.error(f"Failed to save Xero tokens: {e}")
        return RedirectResponse(f"{app_url}/integrations?error=storage_failed")

    return RedirectResponse(f"{app_url}/integrations?success=xero")


@router.post("/xero-api")
async def xero_api(
    body: XeroActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await _get_xero_token(conn)
    access_token = await _refresh_xero_token(conn, token_row)
    tenant_id = token_row.get("tenant_id")

    if not tenant_id:
        raise HTTPException(status_code=400, detail="No Xero tenant connected")

    xero_headers = {
        "Authorization": f"Bearer {access_token}",
        "Xero-Tenant-Id": tenant_id,
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        if body.action == "create_invoice":
            if not body.invoice:
                raise HTTPException(status_code=400, detail="Missing invoice object")
            resp = await client.post(
                f"{XERO_API_BASE}/Invoices",
                headers={**xero_headers, "Content-Type": "application/json"},
                json={"Invoices": [body.invoice]},
            )
        elif body.action == "create_expense":
            if not body.bank_transaction:
                raise HTTPException(status_code=400, detail="Missing bank_transaction object")
            resp = await client.post(
                f"{XERO_API_BASE}/BankTransactions",
                headers={**xero_headers, "Content-Type": "application/json"},
                json={"BankTransactions": [body.bank_transaction]},
            )
        elif body.action == "list_bank_accounts":
            resp = await client.get(
                f"{XERO_API_BASE}/Accounts?where=Type%3D%22BANK%22",
                headers=xero_headers,
            )
        elif body.action == "list_invoices":
            hdrs = dict(xero_headers)
            if body.modified_after:
                hdrs["If-Modified-Since"] = body.modified_after
            resp = await client.get(f"{XERO_API_BASE}/Invoices", headers=hdrs)
        elif body.action == "get_invoice":
            resp = await client.get(f"{XERO_API_BASE}/Invoices/{body.invoice_id}", headers=xero_headers)
        elif body.action == "list_contacts":
            hdrs = dict(xero_headers)
            if body.modified_after:
                hdrs["If-Modified-Since"] = body.modified_after
            resp = await client.get(f"{XERO_API_BASE}/Contacts", headers=hdrs)
        elif body.action == "get_contact":
            resp = await client.get(f"{XERO_API_BASE}/Contacts/{body.contact_id}", headers=xero_headers)
        elif body.action == "get_report":
            resp = await client.get(f"{XERO_API_BASE}/Reports/{body.report_id or 'BalanceSheet'}", headers=xero_headers)
        elif body.action == "aged_receivables":
            resp = await client.get(f"{XERO_API_BASE}/Reports/AgedReceivablesByContact", headers=xero_headers)
        elif body.action == "aged_payables":
            resp = await client.get(f"{XERO_API_BASE}/Reports/AgedPayablesByContact", headers=xero_headers)
        elif body.action == "profit_and_loss":
            resp = await client.get(f"{XERO_API_BASE}/Reports/ProfitAndLoss", headers=xero_headers)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")

    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"Xero API error: {resp.text[:200]}")
    return resp.json()


@router.post("/xero-webhook")
async def xero_webhook(request: Request):
    body = await request.body()
    logger.info(f"Xero webhook received: {len(body)} bytes")
    return {"received": True}


@router.post("/sync-xero-data")
async def sync_xero_data(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await _get_xero_token(conn)
    access_token = await _refresh_xero_token(conn, token_row)
    tenant_id = token_row.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No Xero tenant connected")

    xero_headers = {
        "Authorization": f"Bearer {access_token}",
        "Xero-Tenant-Id": tenant_id,
        "Accept": "application/json",
    }

    invoices_synced = 0
    contacts_synced = 0

    async with httpx.AsyncClient(timeout=60) as client:
        inv_resp = await client.get(f"{XERO_API_BASE}/Invoices", headers=xero_headers)
        if inv_resp.is_success:
            for inv in inv_resp.json().get("Invoices", []):
                try:
                    await conn.execute(
                        """INSERT INTO xero_invoices (id, xero_invoice_id, data, synced_at, created_at)
                           VALUES ($1, $2, $3::jsonb, NOW(), NOW())
                           ON CONFLICT (xero_invoice_id) DO UPDATE SET data = EXCLUDED.data, synced_at = NOW()""",
                        str(uuid.uuid4()), inv.get("InvoiceID"), str(inv),
                    )
                    invoices_synced += 1
                except Exception as e:
                    logger.warning(f"Invoice sync failed: {e}")

        con_resp = await client.get(f"{XERO_API_BASE}/Contacts", headers=xero_headers)
        if con_resp.is_success:
            for contact in con_resp.json().get("Contacts", []):
                try:
                    await conn.execute(
                        """INSERT INTO xero_contacts (id, xero_contact_id, data, synced_at, created_at)
                           VALUES ($1, $2, $3::jsonb, NOW(), NOW())
                           ON CONFLICT (xero_contact_id) DO UPDATE SET data = EXCLUDED.data, synced_at = NOW()""",
                        str(uuid.uuid4()), contact.get("ContactID"), str(contact),
                    )
                    contacts_synced += 1
                except Exception as e:
                    logger.warning(f"Contact sync failed: {e}")

    try:
        await conn.execute(
            """INSERT INTO sync_logs (id, integration, records_synced, synced_at)
               VALUES ($1, 'xero', $2, NOW())""",
            str(uuid.uuid4()), invoices_synced + contacts_synced,
        )
    except Exception:
        pass

    return {
        "invoices_synced": invoices_synced,
        "contacts_synced": contacts_synced,
        "total": invoices_synced + contacts_synced,
    }
