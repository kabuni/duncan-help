"""
Basecamp integration: basecamp-auth, basecamp-callback, basecamp-api, basecamp-webhook
Account ID: 6160637
"""
import uuid
import hashlib
import hmac
import secrets
import logging
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
router = APIRouter(tags=["basecamp"])

BASECAMP_ACCOUNT_ID = "6160637"
BASECAMP_AUTH_URL = "https://launchpad.37signals.com/authorization/new"
BASECAMP_TOKEN_URL = "https://launchpad.37signals.com/authorization/token"
BASECAMP_API_BASE = f"https://3.basecampapi.com/{BASECAMP_ACCOUNT_ID}"
USER_AGENT = "Duncan (Kabuni internal assistant; contact@kabuni.com)"

# 60-second deduplication window for webhook events
_webhook_seen: dict[str, float] = {}


class BasecampActionRequest(BaseModel):
    action: str
    project_id: Optional[str] = None
    todo_list_id: Optional[str] = None
    todo_id: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    assignee_ids: Optional[list[int]] = None
    due_on: Optional[str] = None


async def _get_basecamp_token(user_id: str, conn: asyncpg.Connection) -> Optional[dict]:
    row = await conn.fetchrow("SELECT * FROM basecamp_tokens WHERE user_id = $1", user_id)
    return dict(row) if row else None


async def _basecamp_request(method: str, url: str, access_token: str, **kwargs) -> dict:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(method, url, headers=headers, **kwargs)
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"Basecamp API: {resp.text[:200]}")
    if resp.status_code == 204:
        return {}
    return resp.json()


@router.get("/basecamp-auth")
async def basecamp_auth(current_user: dict = Depends(get_current_user)):
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": settings.BASECAMP_CLIENT_ID,
        "redirect_uri": f"{settings.APP_URL}/basecamp-callback",
        "response_type": "code",
        "type": "web_server",
        "state": state,
    }
    url = BASECAMP_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/basecamp-callback")
async def basecamp_callback(
    code: str,
    state: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    user_id = state.split(":")[0] if state and ":" in state else None
    if not user_id:
        return RedirectResponse(f"{settings.APP_URL}?error=invalid_state")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            BASECAMP_TOKEN_URL,
            params={
                "type": "web_server",
                "client_id": settings.BASECAMP_CLIENT_ID,
                "client_secret": settings.BASECAMP_CLIENT_SECRET,
                "redirect_uri": f"{settings.APP_URL}/basecamp-callback",
                "code": code,
            },
        )
    if not resp.is_success:
        return RedirectResponse(f"{settings.APP_URL}?error=basecamp_auth_failed")

    tokens = resp.json()
    token_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO basecamp_tokens (id, user_id, access_token, refresh_token, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
               access_token = EXCLUDED.access_token,
               refresh_token = COALESCE(EXCLUDED.refresh_token, basecamp_tokens.refresh_token),
               updated_at = NOW()""",
        token_id, user_id, tokens["access_token"], tokens.get("refresh_token"),
    )
    return RedirectResponse(f"{settings.APP_URL}?basecamp=connected")


@router.post("/basecamp-api")
async def basecamp_api(
    body: BasecampActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await _get_basecamp_token(current_user["id"], conn)

    if body.action == "STATUS":
        return {"connected": token_row is not None}

    if body.action == "DISCONNECT":
        await conn.execute("DELETE FROM basecamp_tokens WHERE user_id = $1", current_user["id"])
        return {"disconnected": True}

    if not token_row:
        raise HTTPException(status_code=401, detail="Basecamp not connected")

    access_token = token_row["access_token"]

    if body.action == "LIST_PROJECTS":
        data = await _basecamp_request("GET", f"{BASECAMP_API_BASE}/projects.json", access_token)
        return {"projects": data}

    if body.action == "GET_PROJECT":
        if not body.project_id:
            raise HTTPException(status_code=400, detail="project_id required")
        data = await _basecamp_request("GET", f"{BASECAMP_API_BASE}/projects/{body.project_id}.json", access_token)
        return data

    if body.action == "LIST_TODO_LISTS":
        if not body.project_id:
            raise HTTPException(status_code=400, detail="project_id required")
        data = await _basecamp_request(
            "GET", f"{BASECAMP_API_BASE}/buckets/{body.project_id}/todosets.json", access_token
        )
        return {"todo_lists": data}

    if body.action == "LIST_TODOS":
        if not all([body.project_id, body.todo_list_id]):
            raise HTTPException(status_code=400, detail="project_id and todo_list_id required")
        data = await _basecamp_request(
            "GET",
            f"{BASECAMP_API_BASE}/buckets/{body.project_id}/todolists/{body.todo_list_id}/todos.json",
            access_token,
        )
        return {"todos": data}

    if body.action == "CREATE_TODO":
        if not all([body.project_id, body.todo_list_id, body.content]):
            raise HTTPException(status_code=400, detail="project_id, todo_list_id, content required")
        payload = {"content": body.content}
        if body.due_on:
            payload["due_on"] = body.due_on
        if body.assignee_ids:
            payload["assignee_ids"] = body.assignee_ids
        data = await _basecamp_request(
            "POST",
            f"{BASECAMP_API_BASE}/buckets/{body.project_id}/todolists/{body.todo_list_id}/todos.json",
            access_token,
            json=payload,
        )
        return data

    if body.action == "COMPLETE_TODO":
        if not all([body.project_id, body.todo_id]):
            raise HTTPException(status_code=400, detail="project_id and todo_id required")
        await _basecamp_request(
            "POST",
            f"{BASECAMP_API_BASE}/buckets/{body.project_id}/todos/{body.todo_id}/completion.json",
            access_token,
        )
        return {"completed": True}

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")


@router.post("/basecamp-webhook")
async def basecamp_webhook(request: Request, conn: asyncpg.Connection = Depends(get_connection)):
    """Receive Basecamp webhook events. Deduplicates within 60-second window."""
    import time

    body = await request.json()
    event_id = body.get("id") or body.get("event_id") or str(uuid.uuid4())

    # 60s deduplication
    now = time.time()
    if event_id in _webhook_seen and (now - _webhook_seen[event_id]) < 60:
        return {"status": "duplicate", "event_id": event_id}
    _webhook_seen[event_id] = now

    # Clean old entries
    expired = [k for k, v in _webhook_seen.items() if now - v > 120]
    for k in expired:
        del _webhook_seen[k]

    event_type = body.get("kind", "")
    logger.info(f"Basecamp webhook: {event_type} id={event_id}")

    # Notify via Slack if configured
    slack_token = settings.SLACK_BOT_TOKEN
    if slack_token and event_type in ("todo_created", "todo_completed", "comment_created"):
        creator = body.get("creator", {})
        recording = body.get("recording", {})
        message = f"*Basecamp*: {creator.get('name', 'Someone')} — {event_type.replace('_', ' ')}: {recording.get('title', '')}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    "https://slack.com/api/chat.postMessage",
                    headers={"Authorization": f"Bearer {slack_token}"},
                    json={"channel": "#basecamp-updates", "text": message},
                )
        except Exception as e:
            logger.warning(f"Slack notification failed: {e}")

    return {"status": "ok", "event_id": event_id}
