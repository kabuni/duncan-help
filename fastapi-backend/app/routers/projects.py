"""
Project management routes.
Real tables: projects, project_members, project_sources, files, file_chunks,
             file_embeddings, chats, cards
"""
import uuid
import logging
import asyncio
from typing import Optional
from io import BytesIO

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.services.azure_blob import upload_blob, delete_blob, sanitize_storage_filename
from app.services.embeddings import embed_text, chunk_text

logger = logging.getLogger(__name__)
router = APIRouter(tags=["projects"])


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None


class CreateProjectChatRequest(BaseModel):
    title: Optional[str] = None


class ProjectMemberRequest(BaseModel):
    user_id: str
    role: Optional[str] = "member"


class PromotePlanRequest(BaseModel):
    chat_id: str
    plan_items: list[dict]
    project_id: str


def _is_admin_or_moderator(user: dict) -> bool:
    return any(r in user.get("roles", []) for r in ("admin", "moderator"))


async def _assert_project_access(conn: asyncpg.Connection, project_id: str, user: dict) -> dict:
    row = await conn.fetchrow(
        """SELECT p.* FROM projects p
           WHERE p.id = $1 AND (
               EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = $2)
               OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = $2 AND ur.role::text IN ('admin','moderator'))
           )""",
        project_id, user["id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    return dict(row)


@router.get("/get-projects")
async def get_projects(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    rows = await conn.fetch(
        """SELECT p.*,
                  COUNT(DISTINCT pm.user_id) as member_count,
                  COUNT(DISTINCT c.id) as card_count
           FROM projects p
           LEFT JOIN project_members pm ON pm.project_id = p.id
           LEFT JOIN cards c ON c.project_id = p.id
           WHERE EXISTS (
               SELECT 1 FROM project_members pm2 WHERE pm2.project_id = p.id AND pm2.user_id = $1
           ) OR EXISTS (
               SELECT 1 FROM user_roles ur WHERE ur.user_id = $1 AND ur.role::text IN ('admin','moderator')
           )
           GROUP BY p.id
           ORDER BY p.created_at DESC""",
        current_user["id"],
    )
    return [dict(r) for r in rows]


@router.post("/create-project", status_code=201)
async def create_project(
    body: CreateProjectRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    project_id = str(uuid.uuid4())
    import re as _re
    base_slug = _re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-") or "project"
    existing = await conn.fetchval("SELECT COUNT(*) FROM projects WHERE slug LIKE $1", f"{base_slug}%")
    slug = base_slug if existing == 0 else f"{base_slug}-{existing}"
    async with conn.transaction():
        await conn.execute(
            """INSERT INTO projects (id, name, slug, description, owner_user_id, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())""",
            project_id, body.name, slug, body.description, current_user["id"],
        )
        await conn.execute(
            """INSERT INTO project_members (id, project_id, user_id, role, invited_by_user_id, created_at)
               VALUES ($1, $2, $3, 'owner', $3, NOW())""",
            str(uuid.uuid4()), project_id, current_user["id"],
        )
    row = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
    return dict(row)


@router.get("/get-projects/{project_id}")
async def get_project(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    return await _assert_project_access(conn, project_id, current_user)


@router.get("/get-project-chats")
async def get_project_chats(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    await _assert_project_access(conn, project_id, current_user)
    rows = await conn.fetch(
        """SELECT ch.*, COUNT(cm.id) as message_count
           FROM chats ch
           LEFT JOIN chat_messages cm ON cm.chat_id = ch.id
           WHERE ch.project_id = $1
           GROUP BY ch.id
           ORDER BY ch.updated_at DESC""",
        project_id,
    )
    return [dict(r) for r in rows]


@router.post("/create-project-chat", status_code=201)
async def create_project_chat(
    project_id: str,
    body: CreateProjectChatRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    await _assert_project_access(conn, project_id, current_user)
    chat_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO chats (id, project_id, owner_user_id, title, chat_type, pinned, archived, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'project', FALSE, FALSE, NOW(), NOW())""",
        chat_id, project_id, current_user["id"], body.title or "New Chat",
    )
    row = await conn.fetchrow("SELECT * FROM chats WHERE id = $1", chat_id)
    return dict(row)


@router.post("/upload-project-file", status_code=201)
async def upload_project_file(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    member = await conn.fetchrow(
        "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
        project_id, current_user["id"],
    )
    if not member and not _is_admin_or_moderator(current_user):
        raise HTTPException(status_code=403, detail="Not a project member")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    safe_name = sanitize_storage_filename(file.filename or "upload")
    blob_path = f"projects/{project_id}/{safe_name}"
    await upload_blob(blob_path, content, file.content_type or "application/octet-stream")

    async with conn.transaction():
        # Create a project_source entry for the file
        source_id = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO project_sources
                   (id, project_id, source_type, title, uploaded_by_user_id, status, created_at, updated_at)
               VALUES ($1, $2, 'file', $3, $4, 'active', NOW(), NOW())""",
            source_id, project_id, file.filename, current_user["id"],
        )
        # Create the file entry
        file_id = str(uuid.uuid4())
        import hashlib as _hl
        checksum = _hl.sha256(content).hexdigest()
        await conn.execute(
            """INSERT INTO files
                   (id, project_source_id, storage_provider, storage_key, original_filename,
                    mime_type, file_size_bytes, checksum_sha256, uploaded_by_user_id,
                    upload_status, created_at, updated_at)
               VALUES ($1, $2, 'azure_blob', $3, $4, $5, $6, $7, $8, 'complete', NOW(), NOW())""",
            file_id, source_id, blob_path, file.filename,
            file.content_type or "application/octet-stream",
            len(content), checksum, current_user["id"],
        )

    asyncio.create_task(_index_file(file_id, content, file.content_type or "", conn))

    return {
        "id": file_id,
        "filename": file.filename,
        "storage_key": blob_path,
        "size": len(content),
    }


async def _index_file(file_id: str, content: bytes, content_type: str, conn: asyncpg.Connection):
    """Extract text, chunk, embed, and store in file_chunks + file_embeddings."""
    try:
        text = _extract_text(content, content_type)
        if not text:
            return
        text = text[:50_000]
        chunks = chunk_text(text)
        from app.services.embeddings import embed_batch
        embeddings = await embed_batch(chunks)
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
            chunk_id = str(uuid.uuid4())
            await conn.execute(
                """INSERT INTO file_chunks (id, file_id, chunk_index, content, created_at)
                   VALUES ($1, $2, $3, $4, NOW())""",
                chunk_id, file_id, i, chunk,
            )
            emb_str = "[" + ",".join(str(x) for x in emb) + "]"
            await conn.execute(
                """INSERT INTO file_embeddings
                       (id, file_chunk_id, embedding, embedding_model, created_at)
                   VALUES ($1, $2, $3::vector, 'text-embedding-3-small', NOW())""",
                str(uuid.uuid4()), chunk_id, emb_str,
            )
    except Exception as e:
        logger.error(f"File indexing failed for {file_id}: {e}")


def _extract_text(content: bytes, content_type: str) -> str:
    try:
        if "pdf" in content_type:
            import PyPDF2
            reader = PyPDF2.PdfReader(BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        elif "word" in content_type or content_type.endswith("wordprocessingml.document"):
            from docx import Document
            doc = Document(BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs)
        else:
            return content.decode("utf-8", errors="ignore")
    except Exception as e:
        logger.warning(f"Text extraction failed: {e}")
        return ""


@router.delete("/delete-project-file/{file_id}")
async def delete_project_file(
    file_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow(
        """SELECT f.*, ps.project_id
           FROM files f
           JOIN project_sources ps ON ps.id = f.project_source_id
           WHERE f.id = $1""",
        file_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    is_uploader = str(row["uploaded_by_user_id"]) == str(current_user["id"])
    member = await conn.fetchrow(
        "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
        row["project_id"], current_user["id"],
    )
    if not member and not is_uploader and not _is_admin_or_moderator(current_user):
        raise HTTPException(status_code=403, detail="Not authorized to delete this file")

    await delete_blob(row["storage_key"])

    # Delete chunks and embeddings (cascade via FK if set up, else explicit)
    chunk_ids = await conn.fetch("SELECT id FROM file_chunks WHERE file_id = $1", file_id)
    for c in chunk_ids:
        await conn.execute("DELETE FROM file_embeddings WHERE file_chunk_id = $1", c["id"])
    await conn.execute("DELETE FROM file_chunks WHERE file_id = $1", file_id)
    await conn.execute("DELETE FROM files WHERE id = $1", file_id)
    return {"deleted": True}


@router.post("/promote-plan-to-workstream")
async def promote_plan_to_workstream(
    body: PromotePlanRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    await _assert_project_access(conn, body.project_id, current_user)
    created_cards = []
    async with conn.transaction():
        for item in body.plan_items:
            card_id = str(uuid.uuid4())
            await conn.execute(
                """INSERT INTO cards
                       (id, project_id, title, description, card_type, status, priority,
                        created_by_user_id, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, 'task', 'open', 'medium', $5, NOW(), NOW())""",
                card_id, body.project_id,
                item.get("title", "Untitled Task"),
                item.get("description"),
                current_user["id"],
            )
            created_cards.append(card_id)
    return {"created_cards": created_cards, "count": len(created_cards)}


@router.post("/project-member-added-email")
async def project_member_added_email(
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    project_id = body.get("project_id")
    new_member_id = body.get("user_id")
    project = await conn.fetchrow("SELECT name FROM projects WHERE id = $1", project_id)
    user = await conn.fetchrow("SELECT email, full_name FROM users WHERE id = $1", new_member_id)
    logger.info(
        f"Project member email: {user['email'] if user else 'unknown'} "
        f"added to {project['name'] if project else project_id}"
    )
    return {"sent": True}
