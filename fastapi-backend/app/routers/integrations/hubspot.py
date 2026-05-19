"""HubSpot CRM integration: hubspot-api"""
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["hubspot"])

HUBSPOT_API_BASE = "https://api.hubapi.com"


class HubSpotActionRequest(BaseModel):
    action: str
    object_type: str = "contacts"
    object_id: Optional[str] = None
    properties: Optional[dict] = None
    query: Optional[str] = None
    limit: int = 20


async def _hubspot_request(method: str, url: str, **kwargs) -> dict:
    api_key = settings.HUBSPOT_API_KEY if hasattr(settings, "HUBSPOT_API_KEY") else ""
    if not api_key:
        raise HTTPException(status_code=503, detail="HubSpot API key not configured")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(method, url, headers=headers, **kwargs)
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"HubSpot: {resp.text[:200]}")
    return resp.json()


@router.post("/hubspot-api")
async def hubspot_api(
    body: HubSpotActionRequest,
    current_user: dict = Depends(get_current_user),
):
    if body.action == "LIST":
        data = await _hubspot_request(
            "GET",
            f"{HUBSPOT_API_BASE}/crm/v3/objects/{body.object_type}",
            params={"limit": min(body.limit, 100)},
        )
        return data

    if body.action == "GET":
        if not body.object_id:
            raise HTTPException(status_code=400, detail="object_id required")
        data = await _hubspot_request(
            "GET", f"{HUBSPOT_API_BASE}/crm/v3/objects/{body.object_type}/{body.object_id}"
        )
        return data

    if body.action == "SEARCH":
        search_body = {
            "filterGroups": [],
            "query": body.query or "",
            "limit": min(body.limit, 100),
        }
        data = await _hubspot_request(
            "POST",
            f"{HUBSPOT_API_BASE}/crm/v3/objects/{body.object_type}/search",
            json=search_body,
        )
        return data

    if body.action == "CREATE":
        if not body.properties:
            raise HTTPException(status_code=400, detail="properties required for CREATE")
        data = await _hubspot_request(
            "POST",
            f"{HUBSPOT_API_BASE}/crm/v3/objects/{body.object_type}",
            json={"properties": body.properties},
        )
        return data

    if body.action == "UPDATE":
        if not body.object_id:
            raise HTTPException(status_code=400, detail="object_id required")
        data = await _hubspot_request(
            "PATCH",
            f"{HUBSPOT_API_BASE}/crm/v3/objects/{body.object_type}/{body.object_id}",
            json={"properties": body.properties or {}},
        )
        return data

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")
