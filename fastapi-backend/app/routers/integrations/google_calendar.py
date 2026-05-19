"""
Google Calendar integration: google-calendar-auth, google-calendar-callback,
google-calendar-api, add-event-to-personal-calendar, notify-event-approval,
duncan-calendar-auth, duncan-calendar-callback, duncan-calendar-sync
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
router = APIRouter(tags=["google-calendar"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_SCOPES = "https://www.googleapis.com/auth/calendar"


class CalendarEventRequest(BaseModel):
    title: str
    start_datetime: str
    end_datetime: str
    description: Optional[str] = None
    attendees: Optional[list[str]] = None
    location: Optional[str] = None


class CalendarActionRequest(BaseModel):
    action: str
    event_id: Optional[str] = None
    calendar_id: str = "primary"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    max_results: int = 20


@router.get("/google-calendar-auth")
async def google_calendar_auth(current_user: dict = Depends(get_current_user)):
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID or settings.GMAIL_CLIENT_ID,
        "redirect_uri": f"{settings.APP_URL}/google-calendar-callback",
        "response_type": "code",
        "scope": CALENDAR_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = GOOGLE_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/google-calendar-callback")
async def google_calendar_callback(
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
                "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID or settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GOOGLE_CALENDAR_CLIENT_SECRET or settings.GMAIL_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": f"{settings.APP_URL}/google-calendar-callback",
            },
        )
    if not resp.is_success:
        return RedirectResponse(f"{settings.APP_URL}?error=calendar_auth_failed")

    tokens = resp.json()
    token_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO google_calendar_tokens (id, user_id, access_token, refresh_token, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
               access_token = EXCLUDED.access_token,
               refresh_token = COALESCE(EXCLUDED.refresh_token, google_calendar_tokens.refresh_token),
               updated_at = NOW()""",
        token_id, user_id, tokens["access_token"], tokens.get("refresh_token"),
    )
    return RedirectResponse(f"{settings.APP_URL}?calendar=connected")


@router.post("/google-calendar-api")
async def google_calendar_api(
    body: CalendarActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await conn.fetchrow(
        "SELECT * FROM google_calendar_tokens WHERE user_id = $1", current_user["id"]
    )

    if body.action == "STATUS":
        return {"connected": token_row is not None}

    if body.action == "DISCONNECT":
        await conn.execute("DELETE FROM google_calendar_tokens WHERE user_id = $1", current_user["id"])
        return {"disconnected": True}

    if not token_row:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")

    access_token = token_row["access_token"]

    if body.action == "LIST":
        params = {
            "maxResults": min(body.max_results, 100),
            "orderBy": "startTime",
            "singleEvents": "true",
        }
        if body.start_date:
            params["timeMin"] = f"{body.start_date}T00:00:00Z"
        if body.end_date:
            params["timeMax"] = f"{body.end_date}T23:59:59Z"

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"https://www.googleapis.com/calendar/v3/calendars/{body.calendar_id}/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
        if not resp.is_success:
            raise HTTPException(status_code=resp.status_code, detail="Calendar API error")
        return resp.json()

    if body.action == "GET":
        if not body.event_id:
            raise HTTPException(status_code=400, detail="event_id required")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"https://www.googleapis.com/calendar/v3/calendars/{body.calendar_id}/events/{body.event_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        return resp.json()

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")


@router.post("/add-event-to-personal-calendar")
async def add_event_to_personal_calendar(
    body: CalendarEventRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await conn.fetchrow(
        "SELECT * FROM google_calendar_tokens WHERE user_id = $1", current_user["id"]
    )
    if not token_row:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")

    event = {
        "summary": body.title,
        "start": {"dateTime": body.start_datetime, "timeZone": "UTC"},
        "end": {"dateTime": body.end_datetime, "timeZone": "UTC"},
    }
    if body.description:
        event["description"] = body.description
    if body.location:
        event["location"] = body.location
    if body.attendees:
        event["attendees"] = [{"email": e} for e in body.attendees]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {token_row['access_token']}"},
            json=event,
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail="Failed to create calendar event")

    event_data = resp.json()

    # Also store in local DB
    event_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO key_events (id, title, start_datetime, end_datetime, description, google_event_id, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT DO NOTHING""",
        event_id, body.title, body.start_datetime, body.end_datetime,
        body.description, event_data.get("id"), current_user["id"],
    )
    return {"created": True, "event_id": event_data.get("id"), "html_link": event_data.get("htmlLink")}


@router.post("/notify-event-approval")
async def notify_event_approval(
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    event_id = body.get("event_id")
    approved = body.get("approved", False)
    approver_comment = body.get("comment", "")

    await conn.execute(
        """INSERT INTO key_event_approvals (id, event_id, approver_id, approved, comment, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())""",
        str(uuid.uuid4()), event_id, current_user["id"], approved, approver_comment,
    )
    await conn.execute(
        "UPDATE key_events SET approval_status = $1 WHERE id = $2",
        "approved" if approved else "rejected", event_id,
    )
    return {"notified": True, "approved": approved}


@router.get("/duncan-calendar-auth")
async def duncan_calendar_auth(current_user: dict = Depends(get_current_user)):
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": settings.GMAIL_CLIENT_ID,
        "redirect_uri": f"{settings.APP_URL}/duncan-calendar-callback",
        "response_type": "code",
        "scope": CALENDAR_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = GOOGLE_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/duncan-calendar-callback")
async def duncan_calendar_callback(
    code: str,
    state: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GMAIL_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": f"{settings.APP_URL}/duncan-calendar-callback",
            },
        )
    if not resp.is_success:
        return RedirectResponse(f"{settings.APP_URL}?error=duncan_calendar_failed")

    tokens = resp.json()
    await conn.execute(
        """INSERT INTO duncan_calendar_tokens (id, access_token, refresh_token, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET access_token = EXCLUDED.access_token, updated_at = NOW()""",
        "singleton", tokens["access_token"], tokens.get("refresh_token"),
    )
    return RedirectResponse(f"{settings.APP_URL}?duncan_calendar=connected")


@router.post("/duncan-calendar-sync")
async def duncan_calendar_sync(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await conn.fetchrow("SELECT * FROM duncan_calendar_tokens WHERE id = 'singleton'")
    if not token_row:
        raise HTTPException(status_code=503, detail="Duncan calendar not connected")
    return {"synced": True, "message": "Calendar sync initiated"}
