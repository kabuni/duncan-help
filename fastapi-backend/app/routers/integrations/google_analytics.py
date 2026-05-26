"""
Google Analytics integration: google-analytics-auth, google-analytics-callback, google-analytics-api
Tables: google_analytics_tokens, company_integrations
"""
import uuid
import base64
import logging
from typing import Optional
from datetime import datetime, timezone

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["google-analytics"])

GA_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GA_TOKEN_URL = "https://oauth2.googleapis.com/token"
GA_DATA_API = "https://analyticsdata.googleapis.com/v1beta"
GA_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta"
GA_SCOPES = "https://www.googleapis.com/auth/analytics.readonly"


class GAActionRequest(BaseModel):
    action: str
    question: Optional[str] = None
    property_id: Optional[str] = None


async def _get_ga_token(conn: asyncpg.Connection) -> dict:
    try:
        row = await conn.fetchrow("SELECT * FROM google_analytics_tokens ORDER BY created_at DESC LIMIT 1")
    except Exception:
        row = None
    if not row:
        raise HTTPException(status_code=400, detail="Google Analytics not connected")
    return dict(row)


async def _refresh_ga_token(conn: asyncpg.Connection, token_row: dict) -> str:
    expiry = token_row.get("token_expiry")
    if expiry:
        if isinstance(expiry, str):
            expiry = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        if expiry.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc):
            return token_row["access_token"]

    client_id = settings.GOOGLE_ANALYTICS_CLIENT_ID or settings.GOOGLE_CALENDAR_CLIENT_ID or settings.GMAIL_CLIENT_ID
    client_secret = settings.GOOGLE_ANALYTICS_CLIENT_SECRET or settings.GOOGLE_CALENDAR_CLIENT_SECRET or settings.GMAIL_CLIENT_SECRET

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GA_TOKEN_URL,
            data={
                "refresh_token": token_row["refresh_token"],
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "refresh_token",
            },
        )
    if not resp.is_success:
        raise HTTPException(status_code=400, detail="GA token refresh failed")

    tokens = resp.json()
    new_expiry = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + tokens["expires_in"], tz=timezone.utc
    )
    try:
        await conn.execute(
            "UPDATE google_analytics_tokens SET access_token = $1, token_expiry = $2 WHERE id = $3",
            tokens["access_token"], new_expiry, token_row["id"],
        )
    except Exception as e:
        logger.warning(f"Could not update GA token: {e}")
    return tokens["access_token"]


@router.get("/google-analytics-auth")
async def google_analytics_auth(current_user: dict = Depends(get_current_user)):
    client_id = (
        settings.GOOGLE_ANALYTICS_CLIENT_ID
        or settings.GOOGLE_CALENDAR_CLIENT_ID
        or settings.GMAIL_CLIENT_ID
    )
    if not client_id:
        raise HTTPException(status_code=503, detail="Google OAuth client ID not configured")

    redirect_uri = f"{settings.APP_URL}/google-analytics-callback"
    state = base64.b64encode(f'{{"user_id": "{current_user["id"]}"}}'.encode()).decode()

    auth_url = (
        f"{GA_AUTH_URL}"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope={GA_SCOPES}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
    )
    return {"url": auth_url}


@router.get("/google-analytics-callback")
async def google_analytics_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    app_url = settings.APP_URL
    if error or not code:
        return RedirectResponse(f"{app_url}/integrations?error={error or 'no_code'}")

    client_id = (
        settings.GOOGLE_ANALYTICS_CLIENT_ID
        or settings.GOOGLE_CALENDAR_CLIENT_ID
        or settings.GMAIL_CLIENT_ID
    )
    client_secret = (
        settings.GOOGLE_ANALYTICS_CLIENT_SECRET
        or settings.GOOGLE_CALENDAR_CLIENT_SECRET
        or settings.GMAIL_CLIENT_SECRET
    )
    redirect_uri = f"{app_url}/google-analytics-callback"

    async with httpx.AsyncClient(timeout=30) as client:
        token_resp = await client.post(
            GA_TOKEN_URL,
            data={
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "authorization_code",
            },
        )
    if not token_resp.is_success:
        logger.error(f"GA token exchange failed: {token_resp.text}")
        return RedirectResponse(f"{app_url}/integrations?error=token_exchange_failed")

    tokens = token_resp.json()
    expiry = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + tokens.get("expires_in", 3600), tz=timezone.utc
    )

    property_id = None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            props_resp = await client.get(
                f"{GA_ADMIN_API}/accountSummaries",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
        if props_resp.is_success:
            summaries = props_resp.json().get("accountSummaries", [])
            if summaries and summaries[0].get("propertySummaries"):
                property_id = summaries[0]["propertySummaries"][0].get("property", "").split("/")[-1]
    except Exception as e:
        logger.warning(f"Failed to get GA property: {e}")

    user_id = None
    if state:
        try:
            import json
            decoded = base64.b64decode(state).decode()
            user_id = json.loads(decoded).get("user_id")
        except Exception:
            pass

    try:
        await conn.execute(
            """INSERT INTO google_analytics_tokens
                   (id, user_id, access_token, refresh_token, token_expiry, property_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
               ON CONFLICT (user_id) DO UPDATE
               SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
                   token_expiry = EXCLUDED.token_expiry, property_id = EXCLUDED.property_id,
                   updated_at = NOW()""",
            str(uuid.uuid4()), user_id,
            tokens["access_token"], tokens.get("refresh_token"),
            expiry, property_id,
        )
    except Exception as e:
        logger.warning(f"Could not save GA tokens (trying without ON CONFLICT): {e}")
        try:
            await conn.execute(
                """INSERT INTO google_analytics_tokens
                       (id, access_token, refresh_token, token_expiry, property_id, created_at)
                   VALUES ($1, $2, $3, $4, $5, NOW())""",
                str(uuid.uuid4()), tokens["access_token"], tokens.get("refresh_token"), expiry, property_id,
            )
        except Exception as e2:
            logger.error(f"GA token save failed: {e2}")
            return RedirectResponse(f"{app_url}/integrations?error=storage_failed")

    return RedirectResponse(f"{app_url}/integrations?success=google-analytics")


@router.post("/google-analytics-api")
async def google_analytics_api(
    body: GAActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    if body.action == "disconnect":
        try:
            await conn.execute("DELETE FROM google_analytics_tokens WHERE id IS NOT NULL")
        except Exception as e:
            logger.warning(f"GA disconnect: {e}")
        return {"disconnected": True}

    token_row = await _get_ga_token(conn)
    access_token = await _refresh_ga_token(conn, token_row)
    property_id = body.property_id or token_row.get("property_id")

    if body.action == "checkConnection":
        return {"connected": True, "property_id": property_id}

    if not property_id:
        raise HTTPException(status_code=400, detail="No GA property connected")

    ga_headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    report_url = f"{GA_DATA_API}/properties/{property_id}:runReport"

    async with httpx.AsyncClient(timeout=60) as client:
        if body.action in ("dashboard", "home_summary"):
            resp = await client.post(
                report_url,
                headers=ga_headers,
                json={
                    "dateRanges": [{"startDate": "30daysAgo", "endDate": "today"}],
                    "metrics": [
                        {"name": "sessions"},
                        {"name": "totalUsers"},
                        {"name": "newUsers"},
                        {"name": "bounceRate"},
                        {"name": "averageSessionDuration"},
                    ],
                    "dimensions": [{"name": "date"}],
                    "orderBys": [{"dimension": {"dimensionName": "date"}}],
                },
            )
            if not resp.is_success:
                raise HTTPException(status_code=resp.status_code, detail=f"GA API error: {resp.text[:200]}")
            return resp.json()

        elif body.action == "askQuestion" and body.question:
            from app.services.llm import CallLLMOptions, call_llm_with_fallback
            resp = await client.post(
                report_url,
                headers=ga_headers,
                json={
                    "dateRanges": [{"startDate": "30daysAgo", "endDate": "today"}],
                    "metrics": [{"name": "sessions"}, {"name": "totalUsers"}],
                },
            )
            summary = resp.json() if resp.is_success else {}
            opts = CallLLMOptions(
                workflow="ga-question",
                messages=[
                    {"role": "system", "content": "You are a Google Analytics expert. Answer based on the data provided."},
                    {"role": "user", "content": f"Question: {body.question}\n\nData: {str(summary)[:3000]}"},
                ],
                max_tokens=500,
            )
            result = await call_llm_with_fallback(opts)
            return {"answer": result["choices"][0]["message"].get("content"), "raw_data": summary}

        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")
