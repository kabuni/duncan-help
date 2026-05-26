"""
Meetings, briefings, CEO workflows.
Real tables: meetings, meeting_participants, cards, card_activity, ceo_briefings, etc.
(meetings and ceo_briefings are created by auth_migration.sql)
"""
import uuid
import logging
from typing import Optional
from datetime import datetime, timezone

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.services.llm import CallLLMOptions, call_llm_with_fallback
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["meetings"])


class CreateMeetingRequest(BaseModel):
    title: str
    description: Optional[str] = None
    date: Optional[str] = None
    duration_mins: Optional[int] = None
    transcript: Optional[str] = None


class AnalyzeMeetingRequest(BaseModel):
    meeting_id: str
    transcript: Optional[str] = None


class GenerateExecSummaryRequest(BaseModel):
    meeting_ids: Optional[list[str]] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


@router.post("/meetings", status_code=201)
async def create_meeting(
    body: CreateMeetingRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    meeting_id = str(uuid.uuid4())
    from datetime import datetime
    date_val = None
    if body.date:
        try:
            date_val = datetime.fromisoformat(body.date.replace("Z", "+00:00"))
        except Exception:
            date_val = None
    await conn.execute(
        """INSERT INTO meetings (id, title, description, date, duration_mins, transcript, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())""",
        meeting_id, body.title, body.description, date_val,
        body.duration_mins, body.transcript, current_user["id"],
    )
    row = await conn.fetchrow("SELECT * FROM meetings WHERE id = $1", meeting_id)
    return dict(row)


@router.get("/meetings")
async def get_meetings(
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        rows = await conn.fetch(
            """SELECT m.*,
                      ARRAY_AGG(DISTINCT mp.user_id) FILTER (WHERE mp.user_id IS NOT NULL) as participant_ids
               FROM meetings m
               LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
               GROUP BY m.id
               ORDER BY m.date DESC
               LIMIT $1""",
            min(limit, 100),
        )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"meetings table not yet available: {e}")
        return []


@router.get("/meetings/{meeting_id}")
async def get_meeting(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT * FROM meetings WHERE id = $1", meeting_id)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return dict(row)


@router.post("/analyze-meeting")
async def analyze_meeting(
    body: AnalyzeMeetingRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    meeting = await conn.fetchrow("SELECT * FROM meetings WHERE id = $1", body.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    transcript = body.transcript or meeting["transcript"] or ""
    if not transcript:
        raise HTTPException(status_code=400, detail="No transcript available")

    opts = CallLLMOptions(
        workflow="analyze-meeting",
        messages=[
            {
                "role": "system",
                "content": """Analyze this meeting transcript and return JSON:
{
  "summary": string,
  "key_decisions": [string],
  "action_items": [{"owner": string, "task": string, "due_date": string|null}],
  "follow_ups": [string],
  "sentiment": "positive|neutral|mixed|concerning",
  "topics": [string]
}""",
            },
            {"role": "user", "content": transcript[:50_000]},
        ],
        response_format={"type": "json_object"},
        max_tokens=3000,
    )
    res = await call_llm_with_fallback(opts)
    import json
    try:
        analysis = json.loads(res["choices"][0]["message"]["content"] or "{}")
    except Exception:
        analysis = {}

    await conn.execute(
        "UPDATE meetings SET ai_summary = $1, ai_action_items = $2, analyzed_at = NOW() WHERE id = $3",
        analysis.get("summary"), json.dumps(analysis.get("action_items", [])), body.meeting_id,
    )
    return {"meeting_id": body.meeting_id, "analysis": analysis}


@router.post("/fetch-plaud-meetings")
async def fetch_plaud_meetings(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    logger.info("Plaud meeting fetch triggered")
    return {"fetched": 0, "message": "Plaud integration requires API credentials"}


@router.post("/daily-briefing")
async def generate_daily_briefing(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
<<<<<<< HEAD
    today = datetime.now(timezone.utc).date().isoformat()

    try:
        existing = await conn.fetchrow(
            "SELECT * FROM ceo_briefings WHERE user_id = $1 AND date = $2::date",
=======
    today = datetime.now(timezone.utc).date()

    try:
        existing = await conn.fetchrow(
            "SELECT * FROM ceo_briefings WHERE user_id = $1 AND date = $2",
>>>>>>> 811253bb (UI Layer Integration)
            current_user["id"], today,
        )
        if existing and existing.get("shown"):
            return {"briefing_id": existing["id"], "cached": True, "content": existing.get("content")}
    except Exception:
        existing = None

    # Gather context from real tables
    try:
        overdue = await conn.fetch(
            """SELECT title, status::text FROM cards WHERE due_date < NOW()::date
               AND status::text NOT IN ('done', 'cancelled') LIMIT 10"""
        )
    except Exception:
        overdue = []

    try:
        upcoming_meetings = await conn.fetch(
            "SELECT title, date FROM meetings WHERE date >= NOW() AND date <= NOW() + INTERVAL '7 days' ORDER BY date LIMIT 5"
        )
    except Exception:
        upcoming_meetings = []

    try:
        recent_activities = await conn.fetch(
            "SELECT activity_type, payload, created_at FROM card_activity ORDER BY created_at DESC LIMIT 10"
        )
    except Exception:
        recent_activities = []

    name = current_user.get("full_name") or current_user.get("email", "").split("@")[0]
    context = f"""Daily Briefing for {name} — {today}

Overdue items: {len(overdue)}
{chr(10).join(f"- {c['title']} ({c['status']})" for c in overdue)}

Upcoming meetings (7 days):
{chr(10).join(f"- {m['title']} on {m['date']}" for m in upcoming_meetings) or 'None scheduled'}

Recent activity:
{chr(10).join(f"- {a['activity_type']}" for a in recent_activities) or 'No recent activity'}"""

    opts = CallLLMOptions(
        workflow="ceo-briefing",
        messages=[
            {"role": "system", "content": "You are Duncan. Generate a concise daily briefing. Structure: priorities for today, overdue items requiring attention, upcoming meetings, team activity. Keep it under 300 words. Be direct and actionable."},
            {"role": "user", "content": context},
        ],
        max_tokens=1000,
    )
    res = await call_llm_with_fallback(opts)
    content = res["choices"][0]["message"].get("content") or ""

    briefing_id = str(uuid.uuid4())
    try:
        await conn.execute(
            """INSERT INTO ceo_briefings (id, user_id, content, date, shown, created_at)
               VALUES ($1, $2, $3, $4, FALSE, NOW())
               ON CONFLICT (user_id, date) DO UPDATE SET content = EXCLUDED.content""",
            briefing_id, current_user["id"], content, today,
        )
    except Exception as e:
        logger.warning(f"Could not save briefing: {e}")

    return {"briefing_id": briefing_id, "content": content}


@router.post("/mark-briefing-shown")
async def mark_briefing_shown(
<<<<<<< HEAD
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    briefing_id = body.get("briefing_id")
    try:
        await conn.execute(
            "UPDATE ceo_briefings SET shown = TRUE WHERE id = $1 AND user_id = $2",
            briefing_id, current_user["id"],
=======
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    today = datetime.now(timezone.utc).date()
    try:
        await conn.execute(
            "UPDATE ceo_briefings SET shown = TRUE WHERE user_id = $1 AND date = $2",
            current_user["id"], today,
>>>>>>> 811253bb (UI Layer Integration)
        )
    except Exception:
        pass
    return {"marked": True}


@router.get("/ceo-briefing-status")
async def ceo_briefing_status(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
<<<<<<< HEAD
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        row = await conn.fetchrow(
            "SELECT id, shown FROM ceo_briefings WHERE user_id = $1 AND date = $2::date",
=======
    today = datetime.now(timezone.utc).date()
    try:
        row = await conn.fetchrow(
            "SELECT id, shown FROM ceo_briefings WHERE user_id = $1 AND date = $2",
>>>>>>> 811253bb (UI Layer Integration)
            current_user["id"], today,
        )
    except Exception:
        row = None
    if not row:
        return {"has_briefing": False, "shown": False}
    return {"has_briefing": True, "briefing_id": row["id"], "shown": row["shown"]}


@router.post("/ceo-email-pulse")
async def ceo_email_pulse(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        gmail_token = await conn.fetchrow(
            "SELECT access_token FROM gmail_tokens WHERE user_id = $1", current_user["id"]
        )
    except Exception:
        gmail_token = None

    if not gmail_token:
        return {"error": "Gmail not connected", "pulse": None}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers={"Authorization": f"Bearer {gmail_token['access_token']}"},
            params={"q": "is:unread newer_than:1d", "maxResults": 20},
        )
    if not resp.is_success:
        return {"error": "Failed to fetch emails", "pulse": None}

    count = len(resp.json().get("messages", []))
    opts = CallLLMOptions(
        workflow="ceo-email-pulse",
        messages=[
            {"role": "system", "content": "Provide a brief email pulse in 2 sentences."},
            {"role": "user", "content": f"You have {count} unread emails in the last 24 hours."},
        ],
        max_tokens=150,
    )
    res = await call_llm_with_fallback(opts)
    return {"unread_count": count, "pulse": res["choices"][0]["message"].get("content")}


@router.post("/ceo-slack-pulse")
async def ceo_slack_pulse(current_user: dict = Depends(get_current_user)):
    slack_token = settings.SLACK_BOT_TOKEN
    if not slack_token:
        return {"error": "Slack not configured", "pulse": None}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://slack.com/api/conversations.list",
            headers={"Authorization": f"Bearer {slack_token}"},
            json={"types": "public_channel,private_channel", "limit": 10},
        )
    channels = resp.json().get("channels", [])
    return {"channel_count": len(channels), "pulse": f"Monitoring {len(channels)} Slack channels."}


@router.post("/send-ceo-briefing-actions")
async def send_ceo_briefing_actions(
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    briefing_id = body.get("briefing_id")
    actions = body.get("actions", [])
    stored = []
    for action in actions:
        action_id = str(uuid.uuid4())
        try:
            await conn.execute(
                """INSERT INTO ceo_action_routing (id, briefing_id, user_id, action_text, assigned_to, status, created_at)
                   VALUES ($1, $2, $3, $4, $5, 'pending', NOW())""",
                action_id, briefing_id, current_user["id"],
                action.get("text"), action.get("assigned_to"),
            )
        except Exception as e:
            logger.warning(f"Could not store action: {e}")
        stored.append(action_id)
    return {"stored_actions": stored}


@router.post("/generate-exec-summary")
async def generate_exec_summary(
    body: GenerateExecSummaryRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    job_id = str(uuid.uuid4())
    try:
        await conn.execute(
            """INSERT INTO ceo_briefing_jobs (id, user_id, status, job_type, created_at)
               VALUES ($1, $2, 'pending', 'exec-summary', NOW())""",
            job_id, current_user["id"],
        )
    except Exception as e:
        logger.warning(f"Could not create exec summary job: {e}")

    import asyncio
    asyncio.create_task(_run_exec_summary(job_id, body, current_user, conn))
    return {"job_id": job_id, "status": "pending", "message": "Generating executive summary in background"}


async def _run_exec_summary(
    job_id: str, body: GenerateExecSummaryRequest, user: dict, conn: asyncpg.Connection
):
    try:
        meetings = []
        if body.meeting_ids:
            rows = await conn.fetch(
                "SELECT title, date, ai_summary, transcript FROM meetings WHERE id = ANY($1)",
                body.meeting_ids,
            )
            meetings = [dict(r) for r in rows]

        context = "\n\n".join([
            f"Meeting: {m['title']} ({m['date']})\n{m.get('ai_summary') or (m.get('transcript') or '')[:2000]}"
            for m in meetings
        ])

        opts = CallLLMOptions(
            workflow="generate-exec-summary",
            messages=[
                {"role": "system", "content": "Generate a comprehensive executive summary. Include strategic themes, key decisions, action items, risks, and opportunities."},
                {"role": "user", "content": context or "No meetings provided. Generate a general status summary."},
            ],
            max_tokens=4096,
        )
        res = await call_llm_with_fallback(opts)
        content = res["choices"][0]["message"].get("content") or ""

        await conn.execute(
            "UPDATE ceo_briefing_jobs SET status = 'done', result = $1, completed_at = NOW() WHERE id = $2",
            content, job_id,
        )
    except Exception as e:
        try:
            await conn.execute(
                "UPDATE ceo_briefing_jobs SET status = 'failed', error = $1 WHERE id = $2",
                str(e), job_id,
            )
        except Exception:
            pass


@router.get("/generate-exec-summary/{job_id}")
async def get_exec_summary_status(
    job_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    try:
        row = await conn.fetchrow(
            "SELECT * FROM ceo_briefing_jobs WHERE id = $1 AND user_id = $2", job_id, current_user["id"]
        )
    except Exception:
        row = None
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return dict(row)
