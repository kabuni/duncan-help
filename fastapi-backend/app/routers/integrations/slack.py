"""
Slack integration: slack-auth, slack-oauth-callback, slack-disconnect,
slack-send-message, slack-test-message
"""
import uuid
import hmac
import hashlib
import logging
import secrets
from typing import Optional

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["slack"])

SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize"
SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access"
SLACK_API_BASE = "https://slack.com/api"
SLACK_SCOPES = "chat:write,channels:read,users:read,im:write,files:read"


class SendMessageRequest(BaseModel):
    channel: str
    text: str
    thread_ts: Optional[str] = None
    blocks: Optional[list] = None


async def _slack_api(method: str, endpoint: str, token: str, **kwargs) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            method, f"{SLACK_API_BASE}/{endpoint}",
            headers={"Authorization": f"Bearer {token}"},
            **kwargs,
        )
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(status_code=400, detail=f"Slack API error: {data.get('error', 'unknown')}")
    return data


@router.get("/slack-auth")
async def slack_auth(current_user: dict = Depends(get_current_user)):
    client_id = settings.SLACK_CLIENT_ID
    if not client_id:
        raise HTTPException(status_code=503, detail="Slack OAuth not configured (SLACK_CLIENT_ID missing)")
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": client_id,
        "scope": SLACK_SCOPES,
        "redirect_uri": f"{settings.APP_URL}/slack-oauth-callback",
        "state": state,
    }
    url = SLACK_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/slack-oauth-callback")
async def slack_oauth_callback(
    code: str,
    state: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    user_id = state.split(":")[0] if state and ":" in state else None

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            SLACK_TOKEN_URL,
            data={
                "code": code,
                "redirect_uri": f"{settings.APP_URL}/slack-oauth-callback",
                "client_id": settings.SLACK_CLIENT_ID,
                "client_secret": settings.SLACK_CLIENT_SECRET,
            },
        )
    data = resp.json()
    if not data.get("ok"):
        logger.error(f"Slack token exchange failed: {data.get('error')}")
        return RedirectResponse(f"{settings.APP_URL}?slack=error&reason={data.get('error', 'unknown')}")

    access_token = data.get("access_token") or (data.get("authed_user") or {}).get("access_token")
    team_id = (data.get("team") or {}).get("id")
    team_name = (data.get("team") or {}).get("name")

    if user_id and access_token:
        try:
            await conn.execute(
                """INSERT INTO slack_connections (id, user_id, access_token, team_id, team_name, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                   ON CONFLICT (user_id) DO UPDATE
                   SET access_token = EXCLUDED.access_token, team_id = EXCLUDED.team_id,
                       team_name = EXCLUDED.team_name, updated_at = NOW()""",
                str(uuid.uuid4()), user_id, access_token, team_id, team_name,
            )
        except Exception as e:
            logger.warning(f"Could not save Slack connection: {e}")

    return RedirectResponse(f"{settings.APP_URL}?slack=connected")


@router.post("/slack-disconnect")
async def slack_disconnect(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    await conn.execute("DELETE FROM slack_connections WHERE user_id = $1", current_user["id"])
    return {"disconnected": True}


@router.post("/slack-send-message")
async def slack_send_message(
    body: SendMessageRequest,
    current_user: dict = Depends(get_current_user),
):
    token = settings.SLACK_BOT_TOKEN
    if not token:
        raise HTTPException(status_code=503, detail="Slack bot token not configured")

    payload = {"channel": body.channel, "text": body.text}
    if body.thread_ts:
        payload["thread_ts"] = body.thread_ts
    if body.blocks:
        payload["blocks"] = body.blocks

    data = await _slack_api("POST", "chat.postMessage", token, json=payload)

    await _log_slack_notification(body.channel, body.text, data.get("ts"))
    return {"ok": True, "ts": data.get("ts"), "channel": data.get("channel")}


@router.post("/slack-test-message")
async def slack_test_message(current_user: dict = Depends(get_current_user)):
    token = settings.SLACK_BOT_TOKEN
    if not token:
        raise HTTPException(status_code=503, detail="Slack bot token not configured")

    data = await _slack_api("POST", "chat.postMessage", token, json={
        "channel": current_user.get("slack_user_id") or "#general",
        "text": f"Duncan test message from {current_user.get('display_name', 'unknown')}",
    })
    return {"ok": True, "ts": data.get("ts")}


async def _log_slack_notification(channel: str, text: str, ts: Optional[str]):
    """Log Slack notification to DB (fire and forget)."""
    pass


async def send_slack_dm(user_slack_id: str, message: str) -> bool:
    """Helper to send a DM to a Slack user by their Slack user ID."""
    token = settings.SLACK_BOT_TOKEN
    if not token:
        return False
    try:
        open_resp = await _slack_api("POST", "conversations.open", token, json={"users": user_slack_id})
        channel_id = open_resp["channel"]["id"]
        await _slack_api("POST", "chat.postMessage", token, json={"channel": channel_id, "text": message})
        return True
    except Exception as e:
        logger.error(f"Slack DM failed to {user_slack_id}: {e}")
        return False
