"""
Azure Blob Storage proxy routes.
Clients never receive SAS URLs — all downloads go through this authenticated proxy.
Real tables: files, project_sources, project_members
"""
import logging
from urllib.parse import unquote

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.services.azure_blob import (
    upload_blob, download_blob, delete_blob, list_blobs,
    sanitize_storage_filename,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/azure-blob-api", tags=["storage"])


@router.get("/download")
async def download_blob_proxy(
    path: str = Query(..., description="Blob storage_key"),
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    blob_path = unquote(path)

    if not await _check_blob_access(blob_path, current_user, conn):
        raise HTTPException(status_code=403, detail="Access denied to this file")

    try:
        data, content_type = await download_blob(blob_path)
    except Exception as e:
        logger.error(f"Blob download failed for {blob_path}: {e}")
        raise HTTPException(status_code=404, detail="File not found")

    filename = blob_path.split("/")[-1]
    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )


@router.get("/list")
async def list_blobs_endpoint(
    prefix: str = "",
    limit: int = 100,
    current_user: dict = Depends(get_current_user),
):
    if not any(r in current_user.get("roles", []) for r in ("admin", "moderator")):
        raise HTTPException(status_code=403, detail="Admin or moderator required")
    blobs = await list_blobs(prefix=prefix, limit=min(limit, 500))
    return {"blobs": blobs, "count": len(blobs)}


@router.post("/upload")
async def upload_blob_endpoint(
    blob_path: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    safe_path = sanitize_storage_filename(blob_path)
    stored_path = await upload_blob(safe_path, content, file.content_type or "application/octet-stream")
    return {"path": stored_path, "size": len(content)}


@router.delete("/delete")
async def delete_blob_endpoint(
    path: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    if "admin" not in current_user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin required")
    deleted = await delete_blob(unquote(path))
    return {"deleted": deleted}


async def _check_blob_access(blob_path: str, user: dict, conn: asyncpg.Connection) -> bool:
    roles = user.get("roles", [])
    if "admin" in roles or "moderator" in roles:
        return True

    # Check via files table: file.storage_key matches, verify project membership
    row = await conn.fetchrow(
        """SELECT ps.project_id, f.uploaded_by_user_id
           FROM files f
           JOIN project_sources ps ON ps.id = f.project_source_id
           WHERE f.storage_key = $1""",
        blob_path,
    )
    if row:
        if str(row["uploaded_by_user_id"]) == str(user["id"]):
            return True
        member = await conn.fetchrow(
            "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
            row["project_id"], user["id"],
        )
        return member is not None

    parts = blob_path.split("/")

    # CV files: cvs/{candidate_id}/... — recruitment team can access
    if parts and parts[0] == "cvs":
        return True

    # NDA files: ndas/{party}/... — any authenticated user of the org can download
    if parts and parts[0] == "ndas":
        return True

    return False
