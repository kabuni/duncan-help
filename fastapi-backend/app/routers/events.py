"""
Key events, RSVP, approvals, and Duncan calendar routes.
Tables: key_events, key_event_approvals, event_rsvps, key_event_goals,
        duncan_calendar_tokens, google_calendar_tokens, notifications
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

from app.auth.dependencies import get_current_user, require_admin
from app.db_pool import get_connection
from app.config import settings
from app.services.llm import CallLLMOptions, call_llm_with_fallback

logger = logging.getLogger(__name__)
router = APIRouter(tags=["events"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GCAL_API = "https://www.googleapis.com/calendar/v3"
GCAL_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
GCAL_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"


# ── Pydantic models ────────────────────────────────────────────────────────────

class KeyEvent(BaseModel):
    title: str
    description: Optional[str] = None
    event_date: Optional[str] = None
    location: Optional[str] = None
    owner: Optional[str] = None
    objective: Optional[str] = None
    status: str = "draft"
    risk_level: str = "low"


class AddToCalendarRequest(BaseModel):
    event_name: str
    start_at: str
    end_at: str
    all_day: bool = False
    location: Optional[str] = None
    notes: Optional[str] = None
    category: Optional[str] = None


class NotifyApprovalRequest(BaseModel):
    approval_id: str
    kind: str


# ── Key Events CRUD ────────────────────────────────────────────────────────────

@router.get("/key-events")
async def get_key_events(
    status: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        query = "SELECT * FROM key_events WHERE 1=1"
        params = []
        if status:
            params.append(status)
            query += f" AND status = ${len(params)}"
        query += f" ORDER BY event_date ASC NULLS LAST LIMIT {min(limit, 200)}"
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"key_events table not available: {e}")
        return []


@router.post("/key-events", status_code=201)
async def create_key_event(
    body: KeyEvent,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    event_id = str(uuid.uuid4())
    event_date = None
    if body.event_date:
        try:
            event_date = datetime.fromisoformat(body.event_date.replace("Z", "+00:00"))
        except Exception:
            event_date = None

    await conn.execute(
        """INSERT INTO key_events
               (id, title, description, event_date, location, owner, objective,
                status, risk_level, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())""",
        event_id, body.title, body.description, event_date, body.location,
        body.owner, body.objective, body.status, body.risk_level, current_user["id"],
    )
    row = await conn.fetchrow("SELECT * FROM key_events WHERE id = $1", event_id)
    return dict(row)


@router.get("/key-events/{event_id}")
async def get_key_event(
    event_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT * FROM key_events WHERE id = $1", event_id)
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return dict(row)


@router.put("/key-events/{event_id}")
async def update_key_event(
    event_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT id FROM key_events WHERE id = $1", event_id)
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")

    allowed = {"title", "description", "event_date", "location", "owner", "objective", "status", "risk_level"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_parts = []
    params = [event_id]
    for key, val in updates.items():
        params.append(val)
        set_parts.append(f"{key} = ${len(params)}")
    await conn.execute(
        f"UPDATE key_events SET {', '.join(set_parts)}, updated_at = NOW() WHERE id = $1",
        *params,
    )
    updated = await conn.fetchrow("SELECT * FROM key_events WHERE id = $1", event_id)
    return dict(updated)


# ── Approvals ─────────────────────────────────────────────────────────────────

@router.get("/key-event-approvals")
async def get_approvals(
    event_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        if event_id:
            rows = await conn.fetch(
                "SELECT * FROM key_event_approvals WHERE event_id = $1 ORDER BY created_at DESC", event_id
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM key_event_approvals ORDER BY created_at DESC LIMIT 100"
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"key_event_approvals not available: {e}")
        return []


@router.post("/notify-event-approval")
async def notify_event_approval(
    body: NotifyApprovalRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        approval = await conn.fetchrow(
            "SELECT * FROM key_event_approvals WHERE id = $1", body.approval_id
        )
        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        event = await conn.fetchrow(
            "SELECT * FROM key_events WHERE id = $1", approval["event_id"]
        )
        event_title = event["title"] if event else "Event"

        notification_text = {
            "requested": f"Approval requested for: {event_title}",
            "decided": f"Approval decision made for: {event_title}",
            "proposed": f"New proposal for: {event_title}",
            "counter_resolved": f"Counter-proposal resolved for: {event_title}",
        }.get(body.kind, f"Update on: {event_title}")

        notif_id = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO notifications (id, user_id, title, body, type, read, created_at)
               VALUES ($1, $2, 'Event Approval', $3, 'event_approval', FALSE, NOW())""",
            notif_id, current_user["id"], notification_text,
        )
        return {"notified": True, "notification_id": notif_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"notify-event-approval error: {e}")
        return {"notified": False, "error": str(e)}


# ── RSVP ──────────────────────────────────────────────────────────────────────

@router.get("/event-rsvps")
async def get_event_rsvps(
    event_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        rows = await conn.fetch(
            "SELECT * FROM event_rsvps WHERE event_id = $1 ORDER BY created_at DESC", event_id
        )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"event_rsvps not available: {e}")
        return []


@router.post("/process-rsvp-emails")
async def process_rsvp_emails(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        gmail_token = await conn.fetchrow(
            "SELECT * FROM gmail_tokens WHERE email_address = 'events@kabuni.com' OR email_address LIKE '%rsvp%' LIMIT 1"
        )
    except Exception:
        gmail_token = None

    if not gmail_token:
        return {"processed": 0, "message": "RSVP Gmail account not connected"}

    return {"processed": 0, "message": "RSVP email processing requires live Gmail access"}


# ── Add to personal calendar ───────────────────────────────────────────────────

@router.post("/add-event-to-personal-calendar")
async def add_event_to_personal_calendar(
    body: AddToCalendarRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        token_row = await conn.fetchrow(
            "SELECT * FROM google_calendar_tokens WHERE user_id = $1 LIMIT 1", current_user["id"]
        )
    except Exception:
        token_row = None

    if not token_row:
        raise HTTPException(status_code=400, detail="Google Calendar not connected for your account")

    access_token = token_row["access_token"]
    expiry = token_row.get("token_expiry")
    if expiry:
        if isinstance(expiry, str):
            expiry = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        if expiry.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
            # Refresh token
            client_id = settings.GOOGLE_CALENDAR_CLIENT_ID or settings.GMAIL_CLIENT_ID
            client_secret = settings.GOOGLE_CALENDAR_CLIENT_SECRET or settings.GMAIL_CLIENT_SECRET
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    GOOGLE_TOKEN_URL,
                    data={
                        "refresh_token": token_row["refresh_token"],
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "grant_type": "refresh_token",
                    },
                )
            if resp.is_success:
                tokens = resp.json()
                access_token = tokens["access_token"]
                new_expiry = datetime.fromtimestamp(
                    datetime.now(timezone.utc).timestamp() + tokens["expires_in"], tz=timezone.utc
                )
                try:
                    await conn.execute(
                        "UPDATE google_calendar_tokens SET access_token = $1, token_expiry = $2 WHERE id = $3",
                        access_token, new_expiry, token_row["id"],
                    )
                except Exception:
                    pass

    event_body: dict = {
        "summary": body.event_name,
        "description": body.notes or "",
        "location": body.location or "",
    }
    if body.all_day:
        event_date = body.start_at[:10]
        event_body["start"] = {"date": event_date}
        event_body["end"] = {"date": body.end_at[:10]}
    else:
        event_body["start"] = {"dateTime": body.start_at, "timeZone": "UTC"}
        event_body["end"] = {"dateTime": body.end_at, "timeZone": "UTC"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GCAL_API}/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=event_body,
        )

    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"Calendar event creation failed: {resp.text[:200]}")

    return resp.json()


# ── Duncan shared calendar ─────────────────────────────────────────────────────

@router.get("/duncan-calendar-auth")
async def duncan_calendar_auth(current_user: dict = Depends(require_admin)):
    client_id = settings.GOOGLE_CALENDAR_CLIENT_ID or settings.GMAIL_CLIENT_ID
    if not client_id:
        raise HTTPException(status_code=503, detail="Google OAuth not configured")

    redirect_uri = f"{settings.APP_URL}/duncan-calendar-callback"
    auth_url = (
        f"{GOOGLE_AUTH_URL}"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope={GCAL_READONLY_SCOPE}"
        f"&access_type=offline"
        f"&prompt=consent"
    )
    return {"url": auth_url}


@router.get("/duncan-calendar-callback")
async def duncan_calendar_callback(
    code: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    app_url = settings.APP_URL
    if error or not code:
        return RedirectResponse(f"{app_url}/integrations?error={error or 'no_code'}")

    client_id = settings.GOOGLE_CALENDAR_CLIENT_ID or settings.GMAIL_CLIENT_ID
    client_secret = settings.GOOGLE_CALENDAR_CLIENT_SECRET or settings.GMAIL_CLIENT_SECRET
    redirect_uri = f"{app_url}/duncan-calendar-callback"

    async with httpx.AsyncClient(timeout=30) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "authorization_code",
            },
        )
    if not token_resp.is_success:
        return RedirectResponse(f"{app_url}/integrations?error=token_exchange_failed")

    tokens = token_resp.json()
    expiry = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + tokens.get("expires_in", 3600), tz=timezone.utc
    )

    calendar_id = None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            cal_resp = await client.get(
                f"{GCAL_API}/users/me/calendarList",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
        if cal_resp.is_success:
            cals = cal_resp.json().get("items", [])
            for cal in cals:
                if "Duncan" in (cal.get("summary") or "") and "Key Events" in (cal.get("summary") or ""):
                    calendar_id = cal.get("id")
                    break
    except Exception as e:
        logger.warning(f"Failed to find Duncan calendar: {e}")

    try:
        await conn.execute(
            """INSERT INTO duncan_calendar_tokens
                   (id, access_token, refresh_token, token_expiry, calendar_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
               ON CONFLICT (id) DO UPDATE
               SET access_token = EXCLUDED.access_token, updated_at = NOW()""",
            str(uuid.uuid4()), tokens["access_token"], tokens.get("refresh_token"), expiry, calendar_id,
        )
    except Exception as e:
        logger.warning(f"Could not save Duncan calendar tokens: {e}")

    return RedirectResponse(f"{app_url}/integrations?success=duncan-calendar")


@router.post("/duncan-calendar-sync")
async def duncan_calendar_sync(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        token_row = await conn.fetchrow("SELECT * FROM duncan_calendar_tokens LIMIT 1")
    except Exception:
        return {"synced": 0, "message": "Duncan calendar tokens table not available"}

    if not token_row:
        return {"synced": 0, "message": "Duncan calendar not connected"}

    access_token = token_row["access_token"]
    calendar_id = token_row.get("calendar_id", "primary")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{GCAL_API}/calendars/{calendar_id}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"maxResults": 100, "singleEvents": "true", "orderBy": "startTime"},
        )

    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"Calendar sync failed: {resp.text[:200]}")

    events = resp.json().get("items", [])
    synced = 0
    for ev in events:
        try:
            start = ev.get("start", {})
            event_date = start.get("dateTime") or start.get("date")
            await conn.execute(
                """INSERT INTO key_events
                       (id, title, description, event_date, status, risk_level,
                        external_id, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, 'active', 'low', $5, NOW(), NOW())
                   ON CONFLICT (external_id) DO UPDATE
                   SET title = EXCLUDED.title, description = EXCLUDED.description,
                       event_date = EXCLUDED.event_date, updated_at = NOW()""",
                str(uuid.uuid4()), ev.get("summary", "Untitled"),
                ev.get("description"), event_date, ev.get("id"),
            )
            synced += 1
        except Exception as e:
            logger.warning(f"Event sync failed: {e}")

    try:
        await conn.execute(
            """INSERT INTO key_event_sync_log (id, synced_count, synced_at)
               VALUES ($1, $2, NOW())""",
            str(uuid.uuid4()), synced,
        )
    except Exception:
        pass

    return {"synced": synced, "total_events": len(events)}
