"""
Gmail integration: gmail-auth, gmail-callback, gmail-api,
gmail-auto-draft, gmail-train-style
"""
import uuid
import base64
import logging
import secrets
from typing import Optional
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.services.llm import CallLLMOptions, call_llm_with_fallback
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gmail", tags=["gmail"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SCOPES = " ".join([
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/drive.readonly",
])


class GmailActionRequest(BaseModel):
    action: str
    query: Optional[str] = None
    message_id: Optional[str] = None
    thread_id: Optional[str] = None
    to: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    draft_id: Optional[str] = None
    label: Optional[str] = None
    max_results: int = 20


class AutoDraftRequest(BaseModel):
    thread_id: Optional[str] = None
    context: Optional[str] = None
    original_email: Optional[str] = None
    tone: Optional[str] = "professional"


class TrainStyleRequest(BaseModel):
    sample_emails: list[str]


async def _get_gmail_token(user_id: str, conn: asyncpg.Connection) -> Optional[dict]:
    row = await conn.fetchrow(
        "SELECT * FROM gmail_tokens WHERE user_id = $1", user_id
    )
    return dict(row) if row else None


async def _refresh_gmail_token(token_row: dict, conn: asyncpg.Connection) -> str:
    """Refresh an expired Gmail access token."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GMAIL_CLIENT_SECRET,
                "refresh_token": token_row["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
    if not resp.is_success:
        raise HTTPException(status_code=401, detail="Gmail token refresh failed")
    new_tokens = resp.json()
    new_access = new_tokens["access_token"]
    await conn.execute(
        "UPDATE gmail_tokens SET access_token = $1, updated_at = NOW() WHERE id = $2",
        new_access, token_row["id"],
    )
    return new_access


async def _gmail_request(method: str, url: str, access_token: str, **kwargs) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            method, url,
            headers={"Authorization": f"Bearer {access_token}"},
            **kwargs,
        )
    if not resp.is_success:
        err = Exception(f"Gmail API {resp.status_code}: {resp.text[:200]}")
        err.status = resp.status_code  # type: ignore[attr-defined]
        raise err
    return resp.json()


@router.get("/auth")
async def gmail_auth(current_user: dict = Depends(get_current_user)):
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": settings.GMAIL_CLIENT_ID,
        "redirect_uri": f"{settings.APP_URL}/gmail/callback",
        "response_type": "code",
        "scope": GMAIL_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = GOOGLE_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/callback")
async def gmail_callback(
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
                "redirect_uri": f"{settings.APP_URL}/gmail/callback",
            },
        )
    if not resp.is_success:
        return RedirectResponse(f"{settings.APP_URL}?error=gmail_auth_failed")

    tokens = resp.json()
    async with httpx.AsyncClient(timeout=15) as client:
        profile_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
    gmail_email = profile_resp.json().get("email", "") if profile_resp.is_success else ""

    token_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO gmail_tokens (id, user_id, access_token, refresh_token, email, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
               access_token = EXCLUDED.access_token,
               refresh_token = COALESCE(EXCLUDED.refresh_token, gmail_tokens.refresh_token),
               email = EXCLUDED.email,
               updated_at = NOW()""",
        token_id, user_id, tokens["access_token"],
        tokens.get("refresh_token"), gmail_email,
    )
    return RedirectResponse(f"{settings.APP_URL}?gmail=connected")


@router.post("/api")
async def gmail_api(
    body: GmailActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await _get_gmail_token(current_user["id"], conn)

    if body.action == "STATUS":
        return {"connected": token_row is not None, "email": token_row.get("email") if token_row else None}

    if body.action == "DISCONNECT":
        await conn.execute("DELETE FROM gmail_tokens WHERE user_id = $1", current_user["id"])
        return {"disconnected": True}

    if not token_row:
        raise HTTPException(status_code=401, detail="Gmail not connected")

    access_token = token_row["access_token"]

    if body.action == "LIST":
        params = {"maxResults": min(body.max_results, 50)}
        if body.query:
            params["q"] = body.query
        data = await _gmail_request(
            "GET",
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            access_token,
            params=params,
        )
        return {"messages": data.get("messages", []), "resultSizeEstimate": data.get("resultSizeEstimate", 0)}

    if body.action == "READ":
        if not body.message_id:
            raise HTTPException(status_code=400, detail="message_id required")
        data = await _gmail_request(
            "GET",
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{body.message_id}",
            access_token,
            params={"format": "full"},
        )
        return _parse_gmail_message(data)

    if body.action == "SEND":
        if not all([body.to, body.subject, body.body]):
            raise HTTPException(status_code=400, detail="to, subject, body required for SEND")
        raw = _build_email_raw(
            to=body.to, subject=body.subject, body=body.body,
            from_email=token_row.get("email", "me"),
        )
        data = await _gmail_request(
            "POST",
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            access_token,
            json={"raw": raw},
        )
        return {"sent": True, "message_id": data.get("id")}

    if body.action == "CREATE_DRAFT":
        if not all([body.to, body.subject, body.body]):
            raise HTTPException(status_code=400, detail="to, subject, body required")
        raw = _build_email_raw(
            to=body.to, subject=body.subject, body=body.body,
            from_email=token_row.get("email", "me"),
        )
        data = await _gmail_request(
            "POST",
            "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
            access_token,
            json={"message": {"raw": raw}},
        )
        return {"draft_id": data.get("id")}

    if body.action == "READ_THREAD":
        if not body.thread_id:
            raise HTTPException(status_code=400, detail="thread_id required")
        data = await _gmail_request(
            "GET",
            f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{body.thread_id}",
            access_token,
            params={"format": "full"},
        )
        messages = [_parse_gmail_message(m) for m in data.get("messages", [])]
        return {"thread_id": body.thread_id, "messages": messages}

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")


def _parse_gmail_message(msg: dict) -> dict:
    payload = msg.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    body = _extract_body(payload)
    return {
        "id": msg.get("id"),
        "thread_id": msg.get("threadId"),
        "subject": headers.get("subject", "(no subject)"),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "date": headers.get("date", ""),
        "body": body,
        "snippet": msg.get("snippet", ""),
        "labels": msg.get("labelIds", []),
    }


def _extract_body(payload: dict) -> str:
    body_data = payload.get("body", {}).get("data", "")
    if body_data:
        return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="ignore")
    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
    return ""


def _build_email_raw(to: str, subject: str, body: str, from_email: str) -> str:
    msg = MIMEMultipart("alternative")
    msg["To"] = to
    msg["From"] = from_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    return base64.urlsafe_b64encode(msg.as_bytes()).decode()


@router.post("/auto-draft")
async def gmail_auto_draft(
    body: AutoDraftRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    # Load user's writing style profile
    style_profile = await conn.fetchrow(
        "SELECT style_notes FROM gmail_writing_profiles WHERE user_id = $1", current_user["id"]
    )
    style_context = style_profile["style_notes"] if style_profile else "Professional, concise, direct."

    opts = CallLLMOptions(
        workflow="gmail-auto-draft",
        messages=[
            {
                "role": "system",
                "content": f"""You are drafting an email on behalf of {current_user.get('display_name', 'the user')}.
Writing style: {style_context}
Rules: ≤150 words, no AI-isms ("I hope this email finds you well", "as an AI"),
structure: greeting / context / ask / sign-off.
Tone: {body.tone or 'professional'}""",
            },
            {
                "role": "user",
                "content": f"Draft a reply to this email:\n\n{body.original_email or body.context or 'Draft a professional email'}",
            },
        ],
        max_tokens=400,
    )
    res = await call_llm_with_fallback(opts)
    draft = res["choices"][0]["message"].get("content") or ""
    return {"draft": draft}


@router.post("/train-style")
async def gmail_train_style(
    body: TrainStyleRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    sample_text = "\n\n---\n\n".join(body.sample_emails[:10])
    opts = CallLLMOptions(
        workflow="gmail-train-style",
        messages=[
            {
                "role": "system",
                "content": "Analyze these email samples and extract a writing style profile. Return: tone, sentence length preference, greeting style, signature style, common phrases, formality level.",
            },
            {"role": "user", "content": sample_text[:15_000]},
        ],
        max_tokens=500,
    )
    res = await call_llm_with_fallback(opts)
    style_notes = res["choices"][0]["message"].get("content") or ""

    await conn.execute(
        """INSERT INTO gmail_writing_profiles (id, user_id, style_notes, sample_count, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id) DO UPDATE SET style_notes = EXCLUDED.style_notes, sample_count = EXCLUDED.sample_count, updated_at = NOW()""",
        str(uuid.uuid4()), current_user["id"], style_notes, len(body.sample_emails),
    )
    return {"trained": True, "style_notes": style_notes}
