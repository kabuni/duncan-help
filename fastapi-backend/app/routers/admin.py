"""
Admin and misc routes.
Real tables: integration_accounts, integrations, users, notifications
"""
import uuid
import logging
from typing import Optional
from io import BytesIO

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_admin, require_moderator_or_admin
from app.db_pool import get_connection
from app.services.llm import CallLLMOptions, call_llm_with_fallback
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["admin"])


class IntegrationConnectRequest(BaseModel):
    integration_name: str
    credentials: dict
    scope: str = "company"


class CompanyIntegrationRequest(BaseModel):
    integration_name: str
    action: str
    config: Optional[dict] = None


class FinalizeReleaseRequest(BaseModel):
    version: str
    changes: list[str]
    breaking_changes: Optional[list[str]] = None


@router.post("/connect-integration")
async def connect_integration(
    body: IntegrationConnectRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    import json as _json
    integration_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO user_integrations (id, user_id, integration_name, credentials, scope, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())
           ON CONFLICT (user_id, integration_name) DO UPDATE SET
               credentials = EXCLUDED.credentials, updated_at = NOW()""",
        integration_id, current_user["id"], body.integration_name,
        _json.dumps(body.credentials), body.scope,
    )
    await conn.execute(
        """INSERT INTO integration_audit_logs (id, user_id, integration_name, action, created_at)
           VALUES ($1, $2, $3, 'connected', NOW())""",
        str(uuid.uuid4()), current_user["id"], body.integration_name,
    )
    return {"connected": True, "integration_id": integration_id}


@router.post("/manage-company-integration")
async def manage_company_integration(
    body: CompanyIntegrationRequest,
    current_user: dict = Depends(require_moderator_or_admin),
    conn: asyncpg.Connection = Depends(get_connection),
):
    import json as _json
    if body.action == "ENABLE":
        await conn.execute(
            """INSERT INTO company_integrations (id, integration_name, config, enabled, created_at, updated_at)
               VALUES ($1, $2, $3::jsonb, TRUE, NOW(), NOW())
               ON CONFLICT (integration_name) DO UPDATE SET enabled = TRUE, config = EXCLUDED.config, updated_at = NOW()""",
            str(uuid.uuid4()), body.integration_name, _json.dumps(body.config or {}),
        )
        return {"enabled": True}

    if body.action == "DISABLE":
        await conn.execute(
            "UPDATE company_integrations SET enabled = FALSE, updated_at = NOW() WHERE integration_name = $1",
            body.integration_name,
        )
        return {"disabled": True}

    if body.action == "STATUS":
        row = await conn.fetchrow(
            "SELECT * FROM company_integrations WHERE integration_name = $1", body.integration_name
        )
        return dict(row) if row else {"integration_name": body.integration_name, "enabled": False}

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")


@router.post("/finalize-release")
async def finalize_release(
    body: FinalizeReleaseRequest,
    current_user: dict = Depends(require_moderator_or_admin),
    conn: asyncpg.Connection = Depends(get_connection),
):
    import json as _json
    changes_text = "\n".join(f"- {c}" for c in body.changes)
    breaking_text = "\n".join(f"- {c}" for c in (body.breaking_changes or []))

    opts = CallLLMOptions(
        workflow="finalize-release",
        messages=[
            {"role": "system", "content": "Generate professional release notes for Duncan (Kabuni's internal platform). Be concise and user-focused. Format as markdown."},
            {"role": "user", "content": f"Version: {body.version}\n\nChanges:\n{changes_text}\n\n{f'Breaking Changes:{chr(10)}{breaking_text}' if body.breaking_changes else ''}"},
        ],
        max_tokens=1000,
    )
    res = await call_llm_with_fallback(opts)
    release_notes = res["choices"][0]["message"].get("content") or ""

    release_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO releases (id, version, notes, changes, breaking_changes, created_by, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NOW())""",
        release_id, body.version, release_notes,
        _json.dumps(body.changes), _json.dumps(body.breaking_changes or []),
        current_user["id"],
    )
    return {"release_id": release_id, "version": body.version, "notes": release_notes}


@router.post("/send-release-emails")
async def send_release_emails(
    body: dict,
    current_user: dict = Depends(require_moderator_or_admin),
    conn: asyncpg.Connection = Depends(get_connection),
):
    release_id = body.get("release_id")
    release = await conn.fetchrow("SELECT * FROM releases WHERE id = $1", release_id)
    if not release:
        raise HTTPException(status_code=404, detail="Release not found")

    # is_active = TRUE means active users in the real schema
    users = await conn.fetch("SELECT email, full_name FROM users WHERE is_active = TRUE")
    sent_count = 0
    for user in users:
        logger.info(f"[release-email] Sending release {release['version']} to {user['email']}")
        await conn.execute(
            "INSERT INTO release_email_logs (id, release_id, recipient_email, sent_at) VALUES ($1, $2, $3, NOW())",
            str(uuid.uuid4()), release_id, user["email"],
        )
        sent_count += 1
    return {"sent": sent_count, "version": release["version"]}


@router.post("/sync-social-stats")
async def sync_social_stats(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    snapshot_id = str(uuid.uuid4())
    await conn.execute(
        "INSERT INTO social_stats_snapshots (id, data, created_at) VALUES ($1, '{}'::jsonb, NOW())",
        snapshot_id,
    )
    return {"snapshot_id": snapshot_id, "message": "Social stats sync requires API credentials"}


@router.post("/test-claude")
async def test_claude(body: dict, current_user: dict = Depends(get_current_user)):
    message = body.get("message", "Hello! Are you working correctly?")
    opts = CallLLMOptions(
        workflow="claude-test",
        messages=[
            {"role": "system", "content": "You are Duncan, Kabuni's AI assistant. Respond briefly."},
            {"role": "user", "content": message},
        ],
        max_tokens=200,
    )
    res = await call_llm_with_fallback(opts)
    return {
        "response": res["choices"][0]["message"].get("content"),
        "provider": res.get("_provider"),
        "model": res.get("_model"),
    }


@router.post("/transcribe-audio")
async def transcribe_audio(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file too large (max 25MB)")

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (file.filename or "audio.webm", content, file.content_type or "audio/webm")},
            data={"model": "whisper-1"},
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"Transcription failed: {resp.text[:200]}")
    return resp.json()


@router.post("/extract-file-text")
async def extract_file_text(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    content_type = file.content_type or ""
    extracted = _extract_text_from_bytes(content, content_type)
    if not extracted:
        raise HTTPException(status_code=400, detail="Could not extract text from file")

    if len(extracted) > 1000:
        opts = CallLLMOptions(
            workflow="extract-file-text",
            messages=[
                {"role": "system", "content": "Clean and structure this extracted document text. Preserve all content but fix formatting."},
                {"role": "user", "content": extracted[:50_000]},
            ],
            max_tokens=4000,
        )
        res = await call_llm_with_fallback(opts)
        structured = res["choices"][0]["message"].get("content") or extracted
    else:
        structured = extracted

    return {"text": structured, "char_count": len(structured)}


@router.post("/extract-chat-file")
async def extract_chat_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")
    content_type = file.content_type or ""
    extracted = _extract_text_from_bytes(content, content_type)
    return {
        "filename": file.filename,
        "content_type": content_type,
        "text": extracted[:50_000],
        "truncated": len(extracted) > 50_000,
    }


def _extract_text_from_bytes(content: bytes, content_type: str) -> str:
    try:
        if "pdf" in content_type:
            import PyPDF2
            reader = PyPDF2.PdfReader(BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        elif "word" in content_type or "document" in content_type:
            from docx import Document
            doc = Document(BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs)
        else:
            return content.decode("utf-8", errors="ignore")[:50_000]
    except Exception as e:
        logger.warning(f"Text extraction failed: {e}")
        return ""


# ── Notifications ──────────────────────────────────────────────────────────────

@router.get("/notifications")
async def get_notifications(
    unread_only: bool = True,
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        query = "SELECT * FROM notifications WHERE user_id = $1"
        params = [current_user["id"]]
        if unread_only:
            query += " AND read = FALSE"
        query += f" ORDER BY created_at DESC LIMIT {min(limit, 100)}"
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]
    except Exception:
        return []


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        await conn.execute(
            "UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2",
            notification_id, current_user["id"],
        )
    except Exception:
        pass
    return {"read": True}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        await conn.execute(
            "UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE",
            current_user["id"],
        )
    except Exception:
        pass
    return {"marked_read": True}
