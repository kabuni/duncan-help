"""
Azure Blob Storage service.
Uses SharedKey HMAC-SHA256 auth via the azure-storage-blob SDK.
All filenames are sanitized before upload.
"""
import re
import unicodedata
import logging
import asyncio
from typing import Optional
from urllib.parse import quote

from azure.storage.blob.aio import BlobServiceClient
from azure.storage.blob import ContentSettings
from app.config import settings

logger = logging.getLogger(__name__)


def sanitize_storage_filename(name: str) -> str:
    """Normalize a filename for Azure Blob storage."""
    # Strip diacritics
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    # Split extension
    parts = name.rsplit(".", 1)
    base = parts[0]
    ext = f".{parts[1]}" if len(parts) > 1 else ""
    # Lowercase, replace forbidden chars
    base = base.lower()
    base = re.sub(r"[\s\\/:\*\?\"\<\>\|&%#{}^~\[\]`]+", "-", base)
    base = re.sub(r"-{2,}", "-", base).strip("-")
    # Cap length
    max_base = 200 - len(ext)
    base = base[:max_base]
    return base + ext.lower()


def _get_client() -> BlobServiceClient:
    conn_str = settings.AZURE_STORAGE_CONNECTION_STRING
    if conn_str:
        return BlobServiceClient.from_connection_string(conn_str)
    # Build from account + key
    account = settings.AZURE_BLOB_ACCOUNT
    key = settings.AZURE_BLOB_KEY
    conn_str = (
        f"DefaultEndpointsProtocol=https;AccountName={account};"
        f"AccountKey={key};EndpointSuffix=core.windows.net"
    )
    return BlobServiceClient.from_connection_string(conn_str)


async def upload_blob(
    blob_path: str,
    data: bytes,
    content_type: str = "application/octet-stream",
    overwrite: bool = True,
    sanitize: bool = True,
) -> str:
    """Upload bytes to Azure Blob. Returns the blob key (path within container).
    Pass sanitize=False to preserve paths that already contain directory separators."""
    key = sanitize_storage_filename(blob_path) if sanitize else blob_path
    async with _get_client() as client:
        container = client.get_container_client(settings.AZURE_BLOB_CONTAINER)
        blob_client = container.get_blob_client(key)
        await blob_client.upload_blob(
            data,
            overwrite=overwrite,
            content_settings=ContentSettings(content_type=content_type),
        )
    return key


async def download_blob(blob_path: str) -> tuple[bytes, str]:
    """Download a blob. Returns (content_bytes, content_type)."""
    async with _get_client() as client:
        container = client.get_container_client(settings.AZURE_BLOB_CONTAINER)
        blob_client = container.get_blob_client(blob_path)
        stream = await blob_client.download_blob()
        data = await stream.readall()
        props = await blob_client.get_blob_properties()
        content_type = props.content_settings.content_type or "application/octet-stream"
    return data, content_type


async def delete_blob(blob_path: str) -> bool:
    try:
        async with _get_client() as client:
            container = client.get_container_client(settings.AZURE_BLOB_CONTAINER)
            blob_client = container.get_blob_client(blob_path)
            await blob_client.delete_blob()
        return True
    except Exception as e:
        logger.error(f"Delete blob failed for {blob_path}: {e}")
        return False


async def list_blobs(prefix: str = "", limit: int = 100) -> list[dict]:
    """List blobs with optional prefix filter."""
    results = []
    async with _get_client() as client:
        container = client.get_container_client(settings.AZURE_BLOB_CONTAINER)
        async for blob in container.list_blobs(name_starts_with=prefix):
            results.append({
                "name": blob.name,
                "size": blob.size,
                "last_modified": blob.last_modified.isoformat() if blob.last_modified else None,
                "content_type": blob.content_settings.content_type if blob.content_settings else None,
            })
            if len(results) >= limit:
                break
    return results


async def get_blob_url(blob_path: str) -> str:
    """Return the authenticated proxy URL for a blob (never a public SAS URL)."""
    return f"/azure-blob-api/download?path={quote(blob_path)}"
