"""
Recruitment routes: CV parsing, scoring, job descriptions, Hireflix integration.
fetch-gmail-cvs, parse-cv, score-cv-values, score-cv-competencies,
generate-jd, parse-jd-competencies, create-hireflix-position,
delete-hireflix-position, hireflix-send-invite, hireflix-sync-interviews,
hireflix-retry-processor
"""
import uuid
import base64
import json as _json
import logging
from typing import Optional
from io import BytesIO

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.services.llm import CallLLMOptions, call_llm_with_fallback
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/recruitment", tags=["recruitment"])

HIREFLIX_API_URL = "https://api.hireflix.com/me"


class CreateCandidateRequest(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    location: Optional[str] = None
    job_role_id: Optional[str] = None
    cv_text: Optional[str] = None
    status: str = "new"


class ParseCVRequest(BaseModel):
    text: str
    candidate_id: Optional[str] = None
    job_role_id: Optional[str] = None
    save: bool = False


class ScoreCVRequest(BaseModel):
    cv_text: str
    job_description: Optional[str] = None
    candidate_id: Optional[str] = None


class GenerateJDRequest(BaseModel):
    job_title: str
    department: Optional[str] = None
    key_responsibilities: Optional[list[str]] = None
    required_skills: Optional[list[str]] = None
    seniority: Optional[str] = None


class CreateHireflixPositionRequest(BaseModel):
    job_role_id: str
    hireflix_position_id: str  # Create the position in Hireflix dashboard first, then paste its ID here
    title: Optional[str] = None


class HireflixInviteRequest(BaseModel):
    candidate_id: str
    position_id: str


class FetchGmailCVsRequest(BaseModel):
    role_id: Optional[str] = None
    max_results: int = 10
    query: Optional[str] = None


@router.get("/job-roles")
async def get_job_roles(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    rows = await conn.fetch(
        "SELECT jr.*, COUNT(c.id) as candidate_count FROM job_roles jr LEFT JOIN candidates c ON c.job_role_id = jr.id GROUP BY jr.id ORDER BY jr.created_at DESC"
    )
    return [dict(r) for r in rows]


@router.post("/job-roles", status_code=201)
async def create_job_role(
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    role_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO job_roles (id, title, department, description, status, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'active', $5, NOW(), NOW())""",
        role_id, body.get("title"), body.get("department"), body.get("description"), current_user["id"],
    )
    row = await conn.fetchrow("SELECT * FROM job_roles WHERE id = $1", role_id)
    return dict(row)


@router.post("/candidates", status_code=201)
async def create_candidate(
    body: CreateCandidateRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    candidate_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO candidates
               (id, job_role_id, name, email, phone, location, cv_text, status, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())""",
        candidate_id, body.job_role_id, body.name, body.email,
        body.phone, body.location, body.cv_text, body.status, current_user["id"],
    )
    row = await conn.fetchrow("SELECT * FROM candidates WHERE id = $1", candidate_id)
    return dict(row)


@router.delete("/candidates/{candidate_id}")
async def delete_candidate(
    candidate_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT id FROM candidates WHERE id = $1", candidate_id)
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not found")
    await conn.execute("DELETE FROM candidates WHERE id = $1", candidate_id)
    return {"deleted": True}


@router.get("/candidates")
async def get_candidates(
    job_role_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    params = []
    query = "SELECT c.*, jr.title as job_title FROM candidates c LEFT JOIN job_roles jr ON jr.id = c.job_role_id WHERE 1=1"
    if job_role_id:
        params.append(job_role_id)
        query += f" AND c.job_role_id = ${len(params)}"
    if status:
        params.append(status)
        query += f" AND c.status = ${len(params)}"
    query += " ORDER BY c.created_at DESC"
    rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]


@router.post("/parse-cv")
async def parse_cv(
    body: ParseCVRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    opts = CallLLMOptions(
        workflow="parse-cv",
        messages=[
            {
                "role": "system",
                "content": """Extract structured information from this CV. Return JSON with:
{
  "name": string,
  "email": string,
  "phone": string,
  "location": string,
  "summary": string,
  "experience": [{"title": string, "company": string, "duration": string, "description": string}],
  "education": [{"degree": string, "institution": string, "year": string}],
  "skills": [string],
  "languages": [string]
}""",
            },
            {"role": "user", "content": body.text[:50_000]},
        ],
        response_format={"type": "json_object"},
        max_tokens=2000,
    )
    res = await call_llm_with_fallback(opts)
    import json
    try:
        parsed = json.loads(res["choices"][0]["message"]["content"] or "{}")
    except Exception:
        parsed = {}

    candidate_id = body.candidate_id
    if body.save and parsed.get("name"):
        if candidate_id:
            await conn.execute(
                """UPDATE candidates SET name=$1, email=$2, phone=$3, location=$4,
                   cv_text=$5, updated_at=NOW() WHERE id=$6""",
                parsed.get("name"), parsed.get("email"), parsed.get("phone"),
                parsed.get("location"), body.text[:50_000], candidate_id,
            )
        else:
            candidate_id = str(uuid.uuid4())
            await conn.execute(
                """INSERT INTO candidates
                       (id, job_role_id, name, email, phone, location, cv_text, status, created_by, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, NOW(), NOW())""",
                candidate_id, body.job_role_id,
                parsed.get("name"), parsed.get("email"), parsed.get("phone"),
                parsed.get("location"), body.text[:50_000], current_user["id"],
            )

    return {"parsed": parsed, "candidate_id": candidate_id}


@router.post("/score-values")
async def score_cv_values(
    body: ScoreCVRequest,
    current_user: dict = Depends(get_current_user),
):
    opts = CallLLMOptions(
        workflow="score-cv-values",
        messages=[
            {
                "role": "system",
                "content": """Score this CV against Kabuni's core values. Return JSON:
{
  "scores": {
    "innovation": {"score": 0-10, "evidence": string},
    "collaboration": {"score": 0-10, "evidence": string},
    "integrity": {"score": 0-10, "evidence": string},
    "excellence": {"score": 0-10, "evidence": string}
  },
  "overall_values_score": 0-10,
  "summary": string
}""",
            },
            {"role": "user", "content": body.cv_text[:20_000]},
        ],
        response_format={"type": "json_object"},
        max_tokens=1500,
    )
    res = await call_llm_with_fallback(opts)
    import json
    try:
        scored = json.loads(res["choices"][0]["message"]["content"] or "{}")
    except Exception:
        scored = {}
    return scored


@router.post("/score-competencies")
async def score_cv_competencies(
    body: ScoreCVRequest,
    current_user: dict = Depends(get_current_user),
):
    jd_context = f"\n\nJob Description:\n{body.job_description}" if body.job_description else ""
    opts = CallLLMOptions(
        workflow="score-cv-competencies",
        messages=[
            {
                "role": "system",
                "content": f"""Score this CV against required competencies. Return JSON:
{{
  "scores": {{
    "technical_skills": {{"score": 0-10, "evidence": string}},
    "leadership": {{"score": 0-10, "evidence": string}},
    "communication": {{"score": 0-10, "evidence": string}},
    "problem_solving": {{"score": 0-10, "evidence": string}},
    "adaptability": {{"score": 0-10, "evidence": string}}
  }},
  "overall_competency_score": 0-10,
  "recommendation": "strong_yes|yes|maybe|no",
  "summary": string
}}{jd_context}""",
            },
            {"role": "user", "content": body.cv_text[:20_000]},
        ],
        response_format={"type": "json_object"},
        max_tokens=1500,
    )
    res = await call_llm_with_fallback(opts)
    import json
    try:
        scored = json.loads(res["choices"][0]["message"]["content"] or "{}")
    except Exception:
        scored = {}
    return scored


@router.post("/generate-jd")
async def generate_jd(
    body: GenerateJDRequest,
    current_user: dict = Depends(get_current_user),
):
    responsibilities = "\n".join(f"- {r}" for r in (body.key_responsibilities or []))
    skills = "\n".join(f"- {s}" for s in (body.required_skills or []))

    opts = CallLLMOptions(
        workflow="generate-jd",
        messages=[
            {
                "role": "system",
                "content": "Generate a professional job description for Kabuni. Return JSON with: {title, summary, responsibilities, requirements, benefits, about_kabuni}",
            },
            {
                "role": "user",
                "content": f"""Job Title: {body.job_title}
Department: {body.department or 'Not specified'}
Seniority: {body.seniority or 'Mid-level'}
Key Responsibilities:
{responsibilities or 'Not specified'}
Required Skills:
{skills or 'Not specified'}""",
            },
        ],
        response_format={"type": "json_object"},
        max_tokens=2000,
    )
    res = await call_llm_with_fallback(opts)
    import json
    try:
        jd = json.loads(res["choices"][0]["message"]["content"] or "{}")
    except Exception:
        jd = {}
    return {"job_description": jd}


@router.post("/parse-jd")
async def parse_jd_competencies(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    jd_text = body.get("jd_text", "")
    opts = CallLLMOptions(
        workflow="parse-jd-competencies",
        messages=[
            {
                "role": "system",
                "content": "Extract competency requirements from this job description. Return JSON: {required_skills, soft_skills, experience_years, education_level, key_competencies}",
            },
            {"role": "user", "content": jd_text[:10_000]},
        ],
        response_format={"type": "json_object"},
        max_tokens=1000,
    )
    res = await call_llm_with_fallback(opts)
    import json
    try:
        competencies = json.loads(res["choices"][0]["message"]["content"] or "{}")
    except Exception:
        competencies = {}
    return {"competencies": competencies}


async def _hireflix_query(query: str, variables: dict) -> dict:
    api_key = settings.HIREFLIX_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="Hireflix API key not configured")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            HIREFLIX_API_URL,
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
            json={"query": query, "variables": variables},
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"Hireflix API error: {resp.text[:200]}")
    data = resp.json()
    if "errors" in data:
        raise HTTPException(status_code=400, detail=str(data["errors"]))
    return data


@router.get("/hireflix-positions")
async def list_hireflix_positions(
    current_user: dict = Depends(get_current_user),
):
    """List all positions from the Hireflix dashboard."""
    query = "query { positions { id name archived } }"
    result = await _hireflix_query(query, {})
    positions = result.get("data", {}).get("positions", [])
    return [p for p in positions if not p.get("archived")]


@router.post("/create-hireflix-position")
async def create_hireflix_position(
    body: CreateHireflixPositionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    """Link an existing Hireflix position (created in the dashboard) to a job role.
    To find your position IDs, call GET /hireflix-positions first."""
    query = "query { positions { id name archived } }"
    result = await _hireflix_query(query, {})
    positions = result.get("data", {}).get("positions", [])
    match = next((p for p in positions if p["id"] == body.hireflix_position_id), None)
    if not match:
        raise HTTPException(
            status_code=404,
            detail=f"Hireflix position '{body.hireflix_position_id}' not found. "
                   f"Available IDs: {[p['id'] for p in positions[:5]]}",
        )
    await conn.execute(
        "UPDATE job_roles SET hireflix_position_id = $1 WHERE id = $2",
        body.hireflix_position_id, body.job_role_id,
    )
    return {"position_id": body.hireflix_position_id, "title": match["name"], "status": "linked"}


@router.delete("/delete-hireflix-position/{position_id}")
async def delete_hireflix_position(
    position_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Archive a position in Hireflix."""
    mutation = "mutation ArchivePosition($id: ID!) { Position(id: $id) { archive(archive: true) { id } } }"
    result = await _hireflix_query(mutation, {"id": position_id})
    return result.get("data", {})


@router.post("/hireflix-send-invite")
async def hireflix_send_invite(
    body: HireflixInviteRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    candidate = await conn.fetchrow("SELECT * FROM candidates WHERE id = $1", body.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    mutation = """
    mutation InviteCandidate($positionId: String!, $email: EmailAddress!, $firstName: String!, $lastName: String!) {
        inviteCandidateToInterview(input: {
            positionId: $positionId,
            candidate: {
                email: $email,
                firstName: $firstName,
                lastName: $lastName
            }
        }) {
            __typename
            ... on InterviewType { id }
            ... on InterviewAlreadyExistsInPositionError { code message }
        }
    }
    """
    name_parts = (candidate["name"] or "Unknown").split(" ", 1)
    result = await _hireflix_query(mutation, {
        "positionId": body.position_id,
        "email": candidate["email"],
        "firstName": name_parts[0] or "Unknown",
        "lastName": name_parts[1] if len(name_parts) > 1 else "-",
    })
    invite_result = result["data"]["inviteCandidateToInterview"]
    if invite_result.get("__typename") == "InterviewAlreadyExistsInPositionError":
        raise HTTPException(status_code=409, detail=invite_result.get("message", "Candidate already invited"))
    interview_id = invite_result["id"]
    await conn.execute(
        "UPDATE candidates SET hireflix_interview_id = $1, status = 'invited' WHERE id = $2",
        interview_id, body.candidate_id,
    )
    return {"invited": True, "interview_id": interview_id}


@router.post("/hireflix-sync-interviews")
async def hireflix_sync_interviews(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    positions_query = """
    query {
        positions {
            id
            paginatedInterviews(pagination: { limit: 100 }) {
                results {
                    id
                    status
                    candidate { email }
                }
            }
        }
    }
    """
    result = await _hireflix_query(positions_query, {})
    positions = result.get("data", {}).get("positions", [])

    updated = 0
    total = 0
    for pos in positions:
        interviews = (pos.get("paginatedInterviews") or {}).get("results", [])
        for interview in interviews:
            total += 1
            email = (interview.get("candidate") or {}).get("email")
            if not email:
                continue
            candidate = await conn.fetchrow("SELECT id FROM candidates WHERE email = $1", email)
            if candidate:
                await conn.execute(
                    "UPDATE candidates SET hireflix_status = $1, hireflix_interview_id = $2, updated_at = NOW() WHERE id = $3",
                    interview["status"], interview["id"], candidate["id"],
                )
                updated += 1

    return {"synced": total, "updated": updated}


@router.post("/hireflix-retry-processor")
async def hireflix_retry_processor(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    retry_rows = await conn.fetch(
        "SELECT * FROM hireflix_retry_queue WHERE attempts < 3 AND next_attempt_at <= NOW() ORDER BY created_at ASC LIMIT 10"
    )
    processed = 0
    for row in retry_rows:
        try:
            mutation = """
            mutation RetryInvite($positionId: ID!, $email: String!) {
                inviteCandidate(input: { positionId: $positionId, email: $email }) { id status }
            }
            """
            await _hireflix_query(mutation, {"positionId": row["position_id"], "email": row["email"]})
            await conn.execute("DELETE FROM hireflix_retry_queue WHERE id = $1", row["id"])
            processed += 1
        except Exception as e:
            import datetime
            next_attempt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=15 * (row["attempts"] + 1))
            await conn.execute(
                "UPDATE hireflix_retry_queue SET attempts = attempts + 1, next_attempt_at = $1, last_error = $2 WHERE id = $3",
                next_attempt, str(e), row["id"],
            )
    return {"processed": processed, "remaining": len(retry_rows) - processed}


# ---------------------------------------------------------------------------
# Gmail CV ingestion helpers
# ---------------------------------------------------------------------------

def _scan_parts_for_inline_text(parts: list) -> str:
    for part in parts:
        filename = (part.get("filename") or "").lower()
        mime = part.get("mimeType", "")
        body_data = part.get("body", {}).get("data", "")
        if body_data and (filename.endswith((".pdf", ".doc", ".docx")) or "cv" in filename or "resume" in filename):
            raw = base64.urlsafe_b64decode(body_data + "==")
            return _bytes_to_text(raw, mime)
        sub = part.get("parts", [])
        if sub:
            text = _scan_parts_for_inline_text(sub)
            if text:
                return text
    return ""


def _collect_attachment_ids(parts: list) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    for part in parts:
        att_id = part.get("body", {}).get("attachmentId", "")
        filename = (part.get("filename") or "").lower()
        mime = part.get("mimeType", "")
        if att_id and (filename.endswith((".pdf", ".doc", ".docx")) or "cv" in filename or "resume" in filename):
            result.append((att_id, mime, filename))
        sub = part.get("parts", [])
        if sub:
            result.extend(_collect_attachment_ids(sub))
    return result


async def _download_gmail_attachments(msg_id: str, payload: dict, access_token: str) -> str:
    pairs = _collect_attachment_ids(payload.get("parts", []))
    for att_id, mime, _ in pairs:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}/attachments/{att_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            if not resp.is_success:
                continue
            att_data = resp.json().get("data", "")
            if not att_data:
                continue
            raw = base64.urlsafe_b64decode(att_data + "==")
            text = _bytes_to_text(raw, mime)
            if text:
                return text
        except Exception as exc:
            logger.warning(f"Attachment {att_id} download failed: {exc}")
    return ""


def _bytes_to_text(data: bytes, mime_type: str) -> str:
    try:
        if "pdf" in mime_type or data[:4] == b"%PDF":
            return _extract_pdf_text(data)
        if "word" in mime_type or "docx" in mime_type or data[:2] == b"PK":
            return _extract_docx_text(data)
        return data.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def _extract_pdf_text(data: bytes) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except ImportError:
        pass
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except ImportError:
        pass
    return ""


def _extract_docx_text(data: bytes) -> str:
    try:
        from docx import Document
        doc = Document(BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)
    except ImportError:
        pass
    return ""


@router.post("/fetch-gmail-cvs")
async def fetch_gmail_cvs(
    body: FetchGmailCVsRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await conn.fetchrow(
        "SELECT * FROM gmail_tokens WHERE user_id = $1", current_user["id"]
    )
    if not token_row:
        raise HTTPException(status_code=400, detail="Gmail not connected. Please connect Gmail first.")

    access_token = token_row["access_token"]
    max_results = min(body.max_results, 20)
    gmail_query = body.query or "has:attachment (cv OR resume OR curriculum) filename:(pdf OR doc OR docx)"

    async with httpx.AsyncClient(timeout=30) as client:
        list_resp = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"q": gmail_query, "maxResults": max_results + 1},
        )
    if not list_resp.is_success:
        raise HTTPException(status_code=400, detail=f"Gmail API error: {list_resp.text[:200]}")

    messages = list_resp.json().get("messages", [])
    has_more = len(messages) > max_results
    messages = messages[:max_results]

    ingested = 0
    skipped = 0

    import json as _json2
    for msg_ref in messages:
        msg_id = msg_ref["id"]
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                msg_resp = await client.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"format": "full"},
                )
            if not msg_resp.is_success:
                skipped += 1
                continue

            payload = msg_resp.json().get("payload", {})
            cv_text = _scan_parts_for_inline_text(payload.get("parts", []))
            if not cv_text:
                cv_text = await _download_gmail_attachments(msg_id, payload, access_token)
            if not cv_text:
                skipped += 1
                continue

            opts = CallLLMOptions(
                workflow="parse-cv",
                messages=[
                    {
                        "role": "system",
                        "content": '{"name": string, "email": string, "phone": string, "location": string} — extract from the CV. Return only JSON.',
                    },
                    {"role": "user", "content": cv_text[:30_000]},
                ],
                response_format={"type": "json_object"},
                max_tokens=300,
            )
            res = await call_llm_with_fallback(opts)
            try:
                parsed = _json2.loads(res["choices"][0]["message"]["content"] or "{}")
            except Exception:
                skipped += 1
                continue

            candidate_email = (parsed.get("email") or "").strip().lower()
            candidate_name = (parsed.get("name") or "").strip()
            if not candidate_email or not candidate_name:
                skipped += 1
                continue

            if body.role_id:
                existing = await conn.fetchrow(
                    "SELECT id FROM candidates WHERE LOWER(email) = $1 AND job_role_id = $2",
                    candidate_email, body.role_id,
                )
            else:
                existing = await conn.fetchrow(
                    "SELECT id FROM candidates WHERE LOWER(email) = $1", candidate_email
                )
            if existing:
                skipped += 1
                continue

            await conn.execute(
                """INSERT INTO candidates
                       (id, job_role_id, name, email, phone, location, cv_text, status, created_by, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, NOW(), NOW())""",
                str(uuid.uuid4()), body.role_id,
                candidate_name, candidate_email,
                parsed.get("phone"), parsed.get("location"),
                cv_text[:50_000], current_user["id"],
            )
            ingested += 1

        except Exception as exc:
            logger.error(f"fetch-gmail-cvs: message {msg_id} failed: {exc}")
            skipped += 1

    return {"ingested": ingested, "skipped": skipped, "has_more": has_more}
