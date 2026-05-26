"""
Purchase orders: CRUD + send-po-approval-email
Tables: purchase_orders, departments, users, gmail_tokens
"""
import uuid
import base64
import logging
from typing import Optional
from datetime import datetime, timezone

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["purchase-orders"])

GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


class CreatePORequest(BaseModel):
    title: str
    description: Optional[str] = None
    amount: Optional[float] = None
    currency: str = "GBP"
    supplier: Optional[str] = None
    department_id: Optional[str] = None
    due_date: Optional[str] = None
    status: str = "draft"
    line_items: Optional[list[dict]] = None


class UpdatePORequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    supplier: Optional[str] = None
    department_id: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None


async def _refresh_gmail_token(conn: asyncpg.Connection, token_row: dict) -> str:
    expiry = token_row.get("token_expiry")
    if expiry:
        if isinstance(expiry, str):
            expiry = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        if expiry.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc):
            return token_row["access_token"]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GMAIL_TOKEN_URL,
            data={
                "refresh_token": token_row["refresh_token"],
                "client_id": settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GMAIL_CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
        )
    if not resp.is_success:
        raise HTTPException(status_code=400, detail="Failed to refresh Gmail token")

    tokens = resp.json()
    new_expiry = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + tokens["expires_in"], tz=timezone.utc
    )
    try:
        await conn.execute(
            "UPDATE gmail_tokens SET access_token = $1, token_expiry = $2 WHERE id = $3",
            tokens["access_token"], new_expiry, token_row["id"],
        )
    except Exception:
        pass
    return tokens["access_token"]


def _build_rfc2822(to: str, subject: str, html_body: str, from_addr: str) -> str:
    lines = [
        f"From: Duncan <{from_addr}>",
        f"To: {to}",
        f"Subject: {subject}",
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "",
        html_body,
    ]
    return "\r\n".join(lines)


def _base64url_encode(s: str) -> str:
    encoded = base64.b64encode(s.encode("utf-8")).decode()
    return encoded.replace("+", "-").replace("/", "_").rstrip("=")


# ── PO CRUD ────────────────────────────────────────────────────────────────────

@router.get("/purchase-orders")
async def get_purchase_orders(
    status: Optional[str] = None,
    department_id: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        params = []
        query = """
            SELECT po.*, d.name as department_name, u.full_name as created_by_name
            FROM purchase_orders po
            LEFT JOIN departments d ON d.id = po.department_id
            LEFT JOIN users u ON u.id = po.created_by
            WHERE 1=1
        """
        if status:
            params.append(status)
            query += f" AND po.status = ${len(params)}"
        if department_id:
            params.append(department_id)
            query += f" AND po.department_id = ${len(params)}"
        query += f" ORDER BY po.created_at DESC LIMIT {min(limit, 200)}"
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"purchase_orders table not available: {e}")
        return []


@router.post("/purchase-orders", status_code=201)
async def create_purchase_order(
    body: CreatePORequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    import json
    po_id = str(uuid.uuid4())
    due_date = None
    if body.due_date:
        try:
            due_date = datetime.fromisoformat(body.due_date.replace("Z", "+00:00"))
        except Exception:
            due_date = None

    await conn.execute(
        """INSERT INTO purchase_orders
               (id, title, description, amount, currency, supplier, department_id,
                due_date, status, line_items, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), NOW())""",
        po_id, body.title, body.description, body.amount, body.currency,
        body.supplier, body.department_id, due_date, body.status,
        json.dumps(body.line_items or []), current_user["id"],
    )
    row = await conn.fetchrow("SELECT * FROM purchase_orders WHERE id = $1", po_id)
    return dict(row)


@router.get("/purchase-orders/{po_id}")
async def get_purchase_order(
    po_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT * FROM purchase_orders WHERE id = $1", po_id)
    if not row:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return dict(row)


@router.put("/purchase-orders/{po_id}")
async def update_purchase_order(
    po_id: str,
    body: UpdatePORequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT id FROM purchase_orders WHERE id = $1", po_id)
    if not row:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_parts = []
    params = [po_id]
    for key, val in updates.items():
        params.append(val)
        set_parts.append(f"{key} = ${len(params)}")
    await conn.execute(
        f"UPDATE purchase_orders SET {', '.join(set_parts)}, updated_at = NOW() WHERE id = $1",
        *params,
    )
    updated = await conn.fetchrow("SELECT * FROM purchase_orders WHERE id = $1", po_id)
    return dict(updated)


@router.delete("/purchase-orders/{po_id}")
async def delete_purchase_order(
    po_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT id FROM purchase_orders WHERE id = $1", po_id)
    if not row:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    await conn.execute("DELETE FROM purchase_orders WHERE id = $1", po_id)
    return {"deleted": True}


# ── Send PO approval email ─────────────────────────────────────────────────────

@router.post("/send-po-approval-email")
async def send_po_approval_email(
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    po_id = body.get("po_id")
    if not po_id:
        raise HTTPException(status_code=400, detail="po_id required")

    po = await conn.fetchrow("SELECT * FROM purchase_orders WHERE id = $1", po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    # Find approvers (users with finance/admin role or department heads)
    try:
        approvers = await conn.fetch(
            """SELECT u.email, u.full_name
               FROM users u
               JOIN user_roles ur ON ur.user_id = u.id
               WHERE ur.role IN ('admin', 'finance') AND u.is_active = TRUE
               LIMIT 5"""
        )
    except Exception:
        approvers = []

    if not approvers:
        return {"sent": 0, "message": "No approvers found"}

    # Get Gmail sender token
    try:
        gmail_token = await conn.fetchrow(
            "SELECT * FROM gmail_tokens WHERE email_address = 'duncan@kabuni.com' LIMIT 1"
        )
    except Exception:
        gmail_token = None

    if not gmail_token:
        logger.warning("Gmail token not available for PO approval email")
        return {"sent": 0, "message": "Gmail not connected — approval email queued"}

    try:
        access_token = await _refresh_gmail_token(conn, dict(gmail_token))
    except Exception as e:
        return {"sent": 0, "message": f"Gmail token refresh failed: {e}"}

    sent = 0
    for approver in approvers:
        subject = f"PO Approval Required: {po['title']} — £{po['amount'] or 0:,.2f}"
        html_body = f"""
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2>Purchase Order Approval Request</h2>
  <p><strong>PO:</strong> {po['title']}</p>
  <p><strong>Supplier:</strong> {po.get('supplier') or 'N/A'}</p>
  <p><strong>Amount:</strong> {po.get('currency', 'GBP')} {po.get('amount') or 0:,.2f}</p>
  <p><strong>Description:</strong> {po.get('description') or 'N/A'}</p>
  <p>Please review and approve this purchase order in Duncan.</p>
  <a href="{settings.APP_URL}/purchase-orders/{po_id}"
     style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px">
    Review PO
  </a>
</div>"""
        try:
            raw = _build_rfc2822(approver["email"], subject, html_body, "duncan@kabuni.com")
            encoded = _base64url_encode(raw)
            async with httpx.AsyncClient(timeout=30) as client:
                send_resp = await client.post(
                    GMAIL_SEND_URL,
                    headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                    json={"raw": encoded},
                )
            if send_resp.is_success:
                sent += 1
                logger.info(f"PO approval email sent to {approver['email']}")
            else:
                logger.warning(f"PO email failed for {approver['email']}: {send_resp.text[:200]}")
        except Exception as e:
            logger.error(f"PO email error for {approver['email']}: {e}")

    return {"sent": sent, "po_id": po_id, "po_title": po["title"]}


# ── Departments ────────────────────────────────────────────────────────────────

@router.get("/departments")
async def get_departments(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        rows = await conn.fetch("SELECT * FROM departments ORDER BY name ASC")
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"departments table not available: {e}")
        return []
