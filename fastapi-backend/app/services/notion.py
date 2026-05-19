"""Notion API helpers for NDA logging."""
import base64
import json
import logging

import asyncpg
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

NOTION_API_URL = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


async def _get_notion_token(conn: asyncpg.Connection) -> str:
    """Get Notion API token from company_integrations (stored base64-encoded in config.encrypted_api_key)."""
    row = await conn.fetchrow(
        "SELECT config, enabled FROM company_integrations WHERE integration_name = 'notion'"
    )
    if not row or not row["enabled"]:
        raise ValueError("Notion not connected. An admin must connect it first.")

    cfg = row["config"] if isinstance(row["config"], dict) else json.loads(row["config"] or "{}")
    encrypted = cfg.get("encrypted_api_key") or cfg.get("api_key") or cfg.get("token")
    if not encrypted:
        raise ValueError("Notion token not found in company_integrations config")

    try:
        return base64.b64decode(encrypted).decode()
    except Exception:
        return encrypted  # stored unencoded


async def create_nda_row(
    data: dict,
    doc_url: str,
    notion_token: str,
    formatted_date: str,
) -> tuple[str, str]:
    """Create a row in the Notion NDA database. Returns (page_id, page_url)."""
    db_id = settings.NOTION_NDA_DB_ID
    if not db_id:
        raise ValueError("NOTION_NDA_DB_ID not configured")

    properties: dict = {
        "Name": {"title": [{"text": {"content": f"NDA - {data['receiving_party_name']}"}}]},
        "Date of Agreement": {"date": {"start": data["date_of_agreement"]}},
        "Receiving Party Legal Entity Name": {"rich_text": [{"text": {"content": data["receiving_party_entity"]}}]},
        "Registered Address": {"rich_text": [{"text": {"content": data["registered_address"]}}]},
        "Purpose": {"rich_text": [{"text": {"content": data["purpose"]}}]},
        "Doc URL": {"url": doc_url},
        "Submitted By": {"email": data.get("submitter_email", "")},
        "Recipient Email": {"email": data["recipient_email"]},
        "Signature Status": {"checkbox": False},
        "DocuSign Envelope ID": {"rich_text": [{"text": {"content": ""}}]},
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{NOTION_API_URL}/pages",
            headers={
                "Authorization": f"Bearer {notion_token}",
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            },
            json={"parent": {"database_id": db_id}, "properties": properties},
        )

    if not resp.is_success:
        raise ValueError(f"Failed to create Notion row: {resp.text[:300]}")

    page = resp.json()
    return page["id"], page.get("url", "")


async def update_nda_row(page_id: str, notion_token: str, envelope_id: str) -> None:
    """Update Notion page: mark Signature Status=True and store envelope ID."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.patch(
            f"{NOTION_API_URL}/pages/{page_id}",
            headers={
                "Authorization": f"Bearer {notion_token}",
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            },
            json={
                "properties": {
                    "Signature Status": {"checkbox": True},
                    "DocuSign Envelope ID": {"rich_text": [{"text": {"content": envelope_id}}]},
                }
            },
        )

    if not resp.is_success:
        raise ValueError(f"Failed to update Notion page: {resp.text[:300]}")
