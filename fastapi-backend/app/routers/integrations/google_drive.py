"""
Google Drive integration: google-drive-auth, google-drive-callback, google-drive-api
"""
import uuid
import secrets
import logging
from typing import Optional

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["google-drive"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly"


class DriveActionRequest(BaseModel):
    action: str
    file_id: Optional[str] = None
    folder_id: Optional[str] = None
    query: Optional[str] = None
    limit: int = 20


@router.get("/google-drive-auth")
async def google_drive_auth(current_user: dict = Depends(get_current_user)):
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": settings.GMAIL_CLIENT_ID,
        "redirect_uri": f"{settings.APP_URL}/google-drive-callback",
        "response_type": "code",
        "scope": DRIVE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = GOOGLE_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/google-drive-callback")
async def google_drive_callback(
    code: str,
    state: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    user_id = state.split(":")[0] if state and ":" in state else None
    if not user_id:
        return RedirectResponse(f"{settings.APP_URL}?error=invalid_state")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GMAIL_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": f"{settings.APP_URL}/google-drive-callback",
            },
        )
    if not resp.is_success:
        return RedirectResponse(f"{settings.APP_URL}?error=drive_auth_failed")

    tokens = resp.json()
    await conn.execute(
        """INSERT INTO google_drive_tokens (id, user_id, access_token, refresh_token, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
               access_token = EXCLUDED.access_token,
               refresh_token = COALESCE(EXCLUDED.refresh_token, google_drive_tokens.refresh_token),
               updated_at = NOW()""",
        str(uuid.uuid4()), user_id, tokens["access_token"], tokens.get("refresh_token"),
    )
    return RedirectResponse(f"{settings.APP_URL}?drive=connected")


@router.post("/google-drive-api")
async def google_drive_api(
    body: DriveActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await conn.fetchrow("SELECT * FROM google_drive_tokens WHERE user_id = $1", current_user["id"])

    if body.action == "STATUS":
        return {"connected": token_row is not None}

    if body.action == "DISCONNECT":
        await conn.execute("DELETE FROM google_drive_tokens WHERE user_id = $1", current_user["id"])
        return {"disconnected": True}

    if not token_row:
        raise HTTPException(status_code=401, detail="Google Drive not connected")

    access_token = token_row["access_token"]

    if body.action == "LIST":
        params = {
            "pageSize": min(body.limit, 100),
            "fields": "files(id,name,mimeType,size,modifiedTime,webViewLink)",
        }
        if body.query:
            params["q"] = body.query
        if body.folder_id:
            params["q"] = f"'{body.folder_id}' in parents"

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://www.googleapis.com/drive/v3/files",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
        if not resp.is_success:
            raise HTTPException(status_code=resp.status_code, detail="Drive API error")
        return resp.json()

    if body.action == "READ":
        if not body.file_id:
            raise HTTPException(status_code=400, detail="file_id required")
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                f"https://www.googleapis.com/drive/v3/files/{body.file_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"alt": "media"},
            )
        if not resp.is_success:
            raise HTTPException(status_code=resp.status_code, detail="File download failed")
        return {"content": resp.text[:50_000]}

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")
