"""
NDA agentic flow.
Generates Word NDAs from an Azure Blob template, sends via DocuSign (2-signer),
and logs every submission in Notion.
Tables: nda_submissions, nda_chunks
"""
import io
import json
import re
import uuid
import base64
import logging
import zipfile
from datetime import datetime
from typing import Optional

import asyncpg
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.services.azure_blob import download_blob, upload_blob
from app.services.embeddings import embed_text
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nda", tags=["nda"])

NDA_TEMPLATE_PATH = "templates/nda_template.docx"


# ── Pydantic models ──────────────────────────────────────────────────────────

class NDAGenerateRequest(BaseModel):
    submitter_email: Optional[str] = None
    receiving_party_name: str
    receiving_party_entity: str
    date_of_agreement: str  # YYYY-MM-DD
    registered_address: str
    purpose: str
    recipient_name: str
    recipient_email: str
    internal_signer_name: str = "Palash Soundarkar"
    internal_signer_email: str = "palash@kabuni.com"
    submission_id: Optional[str] = None


class NDASendSignatureRequest(BaseModel):
    submission_id: str
    dry_run: bool = False


class NDASearchRequest(BaseModel):
    query: str
    top_k: int = 5
    threshold: float = 0.3


# ── Helpers ──────────────────────────────────────────────────────────────────

def _format_date(iso_date: str) -> str:
    """'2026-05-07' → '7 May 2026'"""
    try:
        d = datetime.strptime(iso_date, "%Y-%m-%d")
        return f"{d.day} {d.strftime('%B %Y')}"
    except Exception:
        return iso_date


def _fill_docx_template(docx_bytes: bytes, replacements: dict[str, str]) -> bytes:
    """Replace {{placeholders}} in word/document.xml (and headers/footers) in-place."""
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zin:
        names = zin.namelist()
        files = {n: zin.read(n) for n in names}

    def _process(raw: bytes) -> bytes:
        xml = raw.decode("utf-8", errors="replace")
        # Strip XML tags that Word inserts inside {{ ... }} spans across runs
        xml = re.sub(
            r'\{\{((?:[^}]|\}(?!\}))*?)\}\}',
            lambda m: "{{" + re.sub(r'<[^>]+>', '', m.group(1)) + "}}",
            xml,
        )
        for ph, val in replacements.items():
            safe = val.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            xml = xml.replace(ph, safe)
        return xml.encode("utf-8")

    targets = [
        n for n in names
        if n == "word/document.xml"
        or n.startswith("word/header")
        or n.startswith("word/footer")
    ]
    for t in targets:
        files[t] = _process(files[t])

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            zout.writestr(n, files[n])
    return buf.getvalue()


def _build_replacements(data: dict, formatted_date: str) -> dict[str, str]:
    sn = data.get("internal_signer_name") or "Palash Soundarkar"
    se = data.get("internal_signer_email") or "palash@kabuni.com"
    sub = data.get("submitter_email", "")
    return {
        "{{Receiving_Party_Legal_Entity_Name}}": data["receiving_party_entity"],
        "{{Date_of_Agreement}}": formatted_date,
        "{{Registered_Address_of_Receiving_Party_Legal_Entity}}": data["registered_address"],
        "{{Purpose}}": data["purpose"],
        "{{Recipient_Name_for_Signature}}": data["recipient_name"],
        "{{Recipient_Email}}": data["recipient_email"],
        "{{Internal_Signer_Name}}": sn,
        "{{Internal_Signer_Email}}": se,
        "{{Submitter_Email}}": sub,
        "{{ReceivingPartyName}}": data["receiving_party_name"],
        "{{ReceivingPartyEntity}}": data["receiving_party_entity"],
        "{{DateOfAgreement}}": formatted_date,
        "{{RegisteredAddress}}": data["registered_address"],
        "{{RecipientName}}": data["recipient_name"],
        "{{RecipientEmail}}": data["recipient_email"],
        "{{InternalSignerName}}": sn,
        "{{InternalSignerEmail}}": se,
        "{{SubmitterEmail}}": sub,
        "{{Receiving Party Name}}": data["receiving_party_name"],
        "{{Receiving Party Entity}}": data["receiving_party_entity"],
        "{{Date of Agreement}}": formatted_date,
        "{{Registered Address}}": data["registered_address"],
        "{{Recipient Name}}": data["recipient_name"],
        "{{Recipient Email}}": data["recipient_email"],
        "{{Internal Signer Name}}": sn,
        "{{Internal Signer Email}}": se,
        "{{Submitter Email}}": sub,
    }


def _build_nda_text(nda: dict) -> str:
    lines = [
        "NON-DISCLOSURE AGREEMENT",
        f"Date of Agreement: {nda.get('date_of_agreement')}",
        "",
        "PARTIES:",
        "Disclosing Party: Kabuni Ltd",
        f"Receiving Party: {nda.get('receiving_party_name')}",
        f"Entity: {nda.get('receiving_party_entity')}",
        f"Registered Address: {nda.get('registered_address')}",
        "",
        "PURPOSE:",
        nda.get("purpose", ""),
        "",
        "SIGNATORIES:",
        f"Internal Signer: {nda.get('internal_signer_name', 'Palash Soundarkar')} ({nda.get('internal_signer_email', 'palash@kabuni.com')})",
        f"External Recipient: {nda.get('recipient_name')} ({nda.get('recipient_email')})",
        "",
        f"STATUS: {nda.get('status')}",
    ]
    if nda.get("docusign_envelope_id"):
        lines.append(f"DocuSign Envelope: {nda['docusign_envelope_id']}")
    if nda.get("google_doc_url"):
        lines.append(f"Document URL: {nda['google_doc_url']}")
    return "\n".join(lines)


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _chunk_nda_text(text: str, min_tok: int = 500, max_tok: int = 800, overlap_tok: int = 100) -> list[dict]:
    # Try NDA section markers first, fall back to paragraph splits
    parts = re.split(r'(?m)(?=^\d+\.\s+[A-Z]|^[A-Z][A-Z\s]{3,}:?\s*$|^Article\s+\d+|^Section\s+\d+)', text)
    sections = [s.strip() for s in parts if s.strip()]
    if len(sections) <= 1:
        sections = [s.strip() for s in text.split("\n\n") if s.strip()]

    chunks: list[dict] = []
    current = ""
    current_tokens = 0

    for section in sections:
        st = _estimate_tokens(section)
        if current_tokens + st <= max_tok:
            current += ("\n\n" if current else "") + section
            current_tokens += st
        else:
            if current_tokens >= min_tok:
                chunks.append({"content": current, "token_count": current_tokens})
                overlap = current[-(overlap_tok * 4):]
                current = overlap + "\n\n" + section
                current_tokens = _estimate_tokens(current)
            else:
                current += ("\n\n" if current else "") + section
                current_tokens += st

    if current:
        chunks.append({"content": current, "token_count": current_tokens})

    return chunks or [{"content": text[:4000], "token_count": _estimate_tokens(text[:4000])}]


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_nda(
    body: NDAGenerateRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    submitter_email = body.submitter_email or current_user.get("email", "unknown")
    data = body.model_dump()
    data["submitter_email"] = submitter_email

    # Idempotency
    submission_id = body.submission_id
    if submission_id:
        existing = await conn.fetchrow(
            "SELECT id, google_doc_id, google_doc_url, notion_page_id, status FROM nda_submissions WHERE id = $1",
            submission_id,
        )
        if existing and existing["google_doc_id"] and existing["status"] == "generated":
            return {
                "success": True,
                "submission_id": str(existing["id"]),
                "blob_path": existing["google_doc_id"],
                "document_url": existing["google_doc_url"],
                "notion_page_id": existing["notion_page_id"],
                "status": "generated",
                "message": "NDA was already generated.",
            }
        if existing:
            await conn.execute(
                "UPDATE nda_submissions SET status = 'generating', last_error = NULL, updated_at = NOW() WHERE id = $1",
                submission_id,
            )
    else:
        submission_id = str(uuid.uuid4())
        date_obj = datetime.strptime(body.date_of_agreement, "%Y-%m-%d").date()
        await conn.execute(
            """INSERT INTO nda_submissions
                   (id, submitter_id, submitter_email, receiving_party_name, receiving_party_entity,
                    date_of_agreement, registered_address, purpose, recipient_name, recipient_email,
                    internal_signer_name, internal_signer_email, status, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'generating',NOW(),NOW())""",
            submission_id, current_user["id"], submitter_email,
            body.receiving_party_name, body.receiving_party_entity,
            date_obj, body.registered_address, body.purpose,
            body.recipient_name, body.recipient_email,
            body.internal_signer_name, body.internal_signer_email,
        )

    formatted_date = _format_date(body.date_of_agreement)

    try:
        template_bytes, _ = await download_blob(NDA_TEMPLATE_PATH)
    except Exception as e:
        await conn.execute(
            "UPDATE nda_submissions SET status = 'failed', last_error = $1, updated_at = NOW() WHERE id = $2",
            f"Template download failed: {e}", submission_id,
        )
        raise HTTPException(status_code=503, detail=f"Failed to download NDA template: {e}")

    try:
        doc_bytes = _fill_docx_template(template_bytes, _build_replacements(data, formatted_date))

        sanitized = re.sub(r'[^a-zA-Z0-9_\- ]', '_', body.receiving_party_name)
        date_str = body.date_of_agreement.replace("-", "_")
        blob_path = f"ndas/{sanitized}/NDA_{date_str}.docx"
        stored_key = await upload_blob(
            blob_path, doc_bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sanitize=False,
        )
        doc_url = (
            f"https://{settings.AZURE_BLOB_ACCOUNT}.blob.core.windows.net"
            f"/{settings.AZURE_BLOB_CONTAINER}/{stored_key}"
        )

        notion_page_id: Optional[str] = None
        notion_page_url: Optional[str] = None
        try:
            from app.services import notion as notion_svc
            notion_token = await notion_svc._get_notion_token(conn)
            notion_page_id, notion_page_url = await notion_svc.create_nda_row(
                data, doc_url, notion_token, formatted_date
            )
        except Exception as ne:
            logger.warning(f"Notion row creation failed (non-critical): {ne}")

        await conn.execute(
            """UPDATE nda_submissions
               SET google_doc_id = $1, google_doc_url = $2, notion_page_id = $3,
                   notion_page_url = $4, status = 'generated', last_error = NULL, updated_at = NOW()
               WHERE id = $5""",
            stored_key, doc_url, notion_page_id, notion_page_url, submission_id,
        )

        return {
            "success": True,
            "submission_id": submission_id,
            "document_url": doc_url,
            "download_url": f"/nda/download/{submission_id}",
            "blob_path": stored_key,
            "notion_page_id": notion_page_id,
            "notion_page_url": notion_page_url,
            "status": "generated",
            "message": (
                f"NDA for {body.receiving_party_name} generated successfully. "
                f"Submission ID: {submission_id}. "
                f"Download it from the NDA Submissions page or via /nda/download/{submission_id}."
            ),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"NDA generation failed: {e}")
        await conn.execute(
            "UPDATE nda_submissions SET status = 'failed', last_error = $1, updated_at = NOW() WHERE id = $2",
            str(e), submission_id,
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send-signature")
async def send_nda_for_signature(
    body: NDASendSignatureRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    if "admin" not in current_user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin access required")

    submission = await conn.fetchrow("SELECT * FROM nda_submissions WHERE id = $1", body.submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    sub = dict(submission)

    if sub.get("docusign_envelope_id"):
        return {
            "success": True,
            "envelope_id": sub["docusign_envelope_id"],
            "message": "Envelope already created for this submission.",
        }

    blob_path = sub.get("google_doc_id")
    if not blob_path:
        raise HTTPException(status_code=400, detail="NDA document not generated yet. Run /nda/generate first.")

    await conn.execute(
        "UPDATE nda_submissions SET status = 'sending_signature', last_error = NULL, updated_at = NOW() WHERE id = $1",
        body.submission_id,
    )

    try:
        doc_bytes, _ = await download_blob(blob_path)
        doc_base64 = base64.b64encode(doc_bytes).decode()

        if body.dry_run:
            await conn.execute(
                "UPDATE nda_submissions SET status = 'generated', last_error = 'Dry run', updated_at = NOW() WHERE id = $1",
                body.submission_id,
            )
            return {
                "success": True,
                "dry_run": True,
                "message": f"Dry run. Document downloaded ({len(doc_bytes)} bytes). Would send to: internal={sub.get('internal_signer_email')}, recipient={sub['recipient_email']}",
                "doc_size_bytes": len(doc_bytes),
            }

        from app.services import docusign as ds
        doc_filename = blob_path.split("/")[-1]
        envelope_id = await ds.create_envelope(sub, doc_base64, doc_filename)

        await conn.execute(
            "UPDATE nda_submissions SET docusign_envelope_id = $1, status = 'sent', last_error = NULL, updated_at = NOW() WHERE id = $2",
            envelope_id, body.submission_id,
        )

        if sub.get("notion_page_id"):
            try:
                from app.services import notion as notion_svc
                notion_token = await notion_svc._get_notion_token(conn)
                await notion_svc.update_nda_row(sub["notion_page_id"], notion_token, envelope_id)
            except Exception as ne:
                logger.warning(f"Notion update failed (non-critical): {ne}")

        return {
            "success": True,
            "envelope_id": envelope_id,
            "submission_id": body.submission_id,
            "message": f"NDA sent for signature. Envelope ID: {envelope_id}",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"NDA send-signature failed: {e}")
        await conn.execute(
            "UPDATE nda_submissions SET status = 'failed', last_error = $1, updated_at = NOW() WHERE id = $2",
            str(e), body.submission_id,
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/submissions")
async def list_nda_submissions(
    limit: int = 50,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    params: list = []
    query = "SELECT * FROM nda_submissions WHERE 1=1"
    if status:
        params.append(status)
        query += f" AND status = ${len(params)}"
    query += f" ORDER BY created_at DESC LIMIT {min(limit, 200)}"
    try:
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"nda_submissions not yet available: {e}")
        return []


@router.post("/search")
async def search_nda(
    body: NDASearchRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    embedding = await embed_text(body.query)
    emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
    try:
        rows = await conn.fetch(
            """SELECT c.id AS chunk_id, c.nda_id, c.chunk_index, c.content, c.token_count,
                      c.metadata, 1 - (c.embedding <=> $1::vector) AS similarity,
                      n.receiving_party_name, n.purpose, n.status, n.date_of_agreement::text
               FROM nda_chunks c
               JOIN nda_submissions n ON c.nda_id = n.id
               WHERE 1 - (c.embedding <=> $1::vector) >= $2
               ORDER BY c.embedding <=> $1::vector
               LIMIT $3""",
            emb_str, body.threshold, body.top_k,
        )
    except Exception as e:
        logger.warning(f"NDA search failed: {e}")
        return {"success": True, "query": body.query, "results": [], "total_results": 0}

    return {
        "success": True,
        "query": body.query,
        "results": [
            {
                "nda_id": str(r["nda_id"]),
                "chunk_index": r["chunk_index"],
                "content": r["content"],
                "similarity": round(float(r["similarity"]), 4),
                "nda_meta": {
                    "receiving_party": r["receiving_party_name"],
                    "purpose": r["purpose"],
                    "status": r["status"],
                    "date": r["date_of_agreement"],
                },
            }
            for r in rows
        ],
        "total_results": len(rows),
    }


@router.post("/vectorize")
async def vectorize_nda(
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    nda_id = body.get("nda_id")
    if not nda_id:
        raise HTTPException(status_code=400, detail="nda_id is required")

    submission = await conn.fetchrow("SELECT * FROM nda_submissions WHERE id = $1", nda_id)
    if not submission:
        raise HTTPException(status_code=404, detail="NDA not found")

    sub = dict(submission)
    nda_text = _build_nda_text(sub)
    chunks = _chunk_nda_text(nda_text)

    embeddings = [await embed_text(c["content"]) for c in chunks]

    await conn.execute("DELETE FROM nda_chunks WHERE nda_id = $1", nda_id)
    for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
        emb_str = "[" + ",".join(str(x) for x in emb) + "]"
        await conn.execute(
            """INSERT INTO nda_chunks (nda_id, chunk_index, content, token_count, embedding, metadata)
               VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)""",
            nda_id, i, chunk["content"], chunk["token_count"], emb_str,
            json.dumps({
                "receiving_party": sub["receiving_party_name"],
                "purpose": sub["purpose"],
                "status": sub["status"],
                "date": str(sub["date_of_agreement"]),
            }),
        )

    return {
        "success": True,
        "nda_id": nda_id,
        "chunks_created": len(chunks),
        "total_tokens": sum(c["token_count"] for c in chunks),
    }


@router.get("/download/{submission_id}")
async def download_nda(
    submission_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    """Download a generated NDA Word document. Accessible by the submitter or admins."""
    row = await conn.fetchrow(
        "SELECT submitter_id, google_doc_id, receiving_party_name, date_of_agreement FROM nda_submissions WHERE id = $1",
        submission_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="NDA submission not found")

    is_admin = "admin" in current_user.get("roles", [])
    is_submitter = str(row["submitter_id"]) == str(current_user["id"])
    if not is_admin and not is_submitter:
        raise HTTPException(status_code=403, detail="Access denied")

    blob_path = row["google_doc_id"]
    if not blob_path:
        raise HTTPException(status_code=400, detail="NDA document has not been generated yet")

    try:
        data, content_type = await download_blob(blob_path)
    except Exception as e:
        logger.error(f"NDA download failed for submission {submission_id}: {e}")
        raise HTTPException(status_code=404, detail="Document not found in storage")

    party = re.sub(r'[^a-zA-Z0-9_\- ]', '_', row["receiving_party_name"])
    date_str = str(row["date_of_agreement"]).replace("-", "_")
    filename = f"NDA_{party}_{date_str}.docx"

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── DocuSign webhook ───────────────────────────────────────────────────────────

@router.post("/docusign-webhook")
async def docusign_webhook(
    request: Request,
    conn: asyncpg.Connection = Depends(get_connection),
):
    """Receives DocuSign Connect webhook events and updates NDA submission status."""
    body_bytes = await request.body()
    content_type = request.headers.get("content-type", "")

    envelope_id = None
    event_type = None

    if "xml" in content_type:
        import re as _re
        env_match = _re.search(r"<EnvelopeID>(.*?)</EnvelopeID>", body_bytes.decode("utf-8", errors="ignore"))
        evt_match = _re.search(r"<EnvelopStatus>(.*?)</EnvelopStatus>", body_bytes.decode("utf-8", errors="ignore"))
        if env_match:
            envelope_id = env_match.group(1)
        if evt_match:
            event_type = evt_match.group(1).lower()
    else:
        try:
            payload = json.loads(body_bytes)
            envelope_id = payload.get("envelopeId") or (payload.get("data") or {}).get("envelopeId")
            event_type = (payload.get("event") or "").lower()
        except Exception:
            pass

    if not envelope_id:
        return {"received": True, "warning": "No envelope ID found in payload"}

    status_map = {
        "envelope-completed": "completed",
        "completed": "completed",
        "envelope-declined": "declined",
        "declined": "declined",
        "envelope-voided": "voided",
        "voided": "voided",
        "envelope-sent": "sent",
        "sent": "sent",
        "envelope-delivered": "delivered",
        "delivered": "delivered",
    }
    new_status = status_map.get(event_type)

    if new_status:
        try:
            await conn.execute(
                "UPDATE nda_submissions SET status = $1, updated_at = NOW() WHERE docusign_envelope_id = $2",
                new_status, envelope_id,
            )
            logger.info(f"DocuSign webhook: envelope {envelope_id} → {new_status}")
        except Exception as e:
            logger.error(f"DocuSign webhook DB update failed: {e}")

    return {"received": True, "envelope_id": envelope_id, "status": new_status}
