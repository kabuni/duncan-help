"""
Azure DevOps integration:
azure-devops-auth, azure-devops-callback, azure-devops-api,
azure-devops-webhook, sync-azure-work-items, azure-repos-api
"""
import uuid
import secrets
import logging
from typing import Optional

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/azure-devops", tags=["azure-devops"])

# Single-tenant auth endpoint (not common/)
AZURE_DEVOPS_AUTH_URL = "https://app.vssps.visualstudio.com/oauth2/authorize"
AZURE_DEVOPS_TOKEN_URL = "https://app.vssps.visualstudio.com/oauth2/token"
DEVOPS_SCOPES = "vso.work vso.code vso.build vso.project"


class DevOpsActionRequest(BaseModel):
    action: str
    project: Optional[str] = None
    work_item_id: Optional[int] = None
    work_item_type: Optional[str] = "Task"
    title: Optional[str] = None
    description: Optional[str] = None
    state: Optional[str] = None
    assigned_to: Optional[str] = None
    query: Optional[str] = None
    repo: Optional[str] = None
    branch: Optional[str] = None
    limit: int = 50


async def _get_devops_token(user_id: str, conn: asyncpg.Connection) -> Optional[dict]:
    row = await conn.fetchrow("SELECT * FROM azure_devops_tokens WHERE user_id = $1", user_id)
    return dict(row) if row else None


async def _devops_request(method: str, url: str, access_token: str, **kwargs) -> dict:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json;api-version=7.1",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(method, url, headers=headers, **kwargs)
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"Azure DevOps API: {resp.text[:200]}")
    if resp.status_code == 204:
        return {}
    return resp.json()


@router.get("/auth")
async def azure_devops_auth(current_user: dict = Depends(get_current_user)):
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": settings.AZURE_DEVOPS_CLIENT_ID,
        "redirect_uri": f"{settings.APP_URL}/azure-devops/callback",
        "response_type": "Assertion",
        "scope": DEVOPS_SCOPES,
        "state": state,
    }
    url = AZURE_DEVOPS_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/callback")
async def azure_devops_callback(
    code: str,
    state: Optional[str] = Query(None),
    conn: asyncpg.Connection = Depends(get_connection),
):
    user_id = state.split(":")[0] if state and ":" in state else None
    if not user_id:
        return RedirectResponse(f"{settings.APP_URL}?error=invalid_state")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            AZURE_DEVOPS_TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                "client_assertion": settings.AZURE_DEVOPS_CLIENT_SECRET,
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": code,
                "redirect_uri": f"{settings.APP_URL}/azure-devops/callback",
            },
        )
    if not resp.is_success:
        return RedirectResponse(f"{settings.APP_URL}?error=devops_auth_failed")

    tokens = resp.json()
    token_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO azure_devops_tokens (id, user_id, access_token, refresh_token, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
               access_token = EXCLUDED.access_token,
               refresh_token = COALESCE(EXCLUDED.refresh_token, azure_devops_tokens.refresh_token),
               updated_at = NOW()""",
        token_id, user_id, tokens["access_token"], tokens.get("refresh_token"),
    )
    return RedirectResponse(f"{settings.APP_URL}?devops=connected")


@router.post("/api")
async def azure_devops_api(
    body: DevOpsActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await _get_devops_token(current_user["id"], conn)
    org_url = settings.AZURE_DEVOPS_ORG_URL.rstrip("/")

    if body.action == "STATUS":
        return {"connected": token_row is not None, "org_url": org_url}

    if body.action == "DISCONNECT":
        await conn.execute("DELETE FROM azure_devops_tokens WHERE user_id = $1", current_user["id"])
        return {"disconnected": True}

    if not token_row:
        raise HTTPException(status_code=401, detail="Azure DevOps not connected")

    access_token = token_row["access_token"]

    if body.action == "LIST_PROJECTS":
        data = await _devops_request("GET", f"{org_url}/_apis/projects", access_token)
        return {"projects": data.get("value", [])}

    if body.action == "LIST_WORK_ITEMS":
        project = body.project or ""
        wiql = body.query or f"SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.TeamProject]='{project}' ORDER BY [System.ChangedDate] DESC"
        wiql_data = await _devops_request(
            "POST", f"{org_url}/{project}/_apis/wit/wiql",
            access_token,
            json={"query": wiql},
            params={"$top": min(body.limit, 200)},
        )
        ids = [str(wi["id"]) for wi in wiql_data.get("workItems", [])[:50]]
        if not ids:
            return {"work_items": []}
        ids_str = ",".join(ids)
        items_data = await _devops_request(
            "GET", f"{org_url}/_apis/wit/workitems",
            access_token,
            params={"ids": ids_str, "$expand": "fields"},
        )
        return {"work_items": items_data.get("value", [])}

    if body.action == "GET_WORK_ITEM":
        if not body.work_item_id:
            raise HTTPException(status_code=400, detail="work_item_id required")
        data = await _devops_request(
            "GET", f"{org_url}/_apis/wit/workitems/{body.work_item_id}",
            access_token, params={"$expand": "all"},
        )
        return data

    if body.action == "CREATE_WORK_ITEM":
        if not all([body.project, body.title]):
            raise HTTPException(status_code=400, detail="project and title required")
        patch_doc = [
            {"op": "add", "path": "/fields/System.Title", "value": body.title},
        ]
        if body.description:
            patch_doc.append({"op": "add", "path": "/fields/System.Description", "value": body.description})
        if body.assigned_to:
            patch_doc.append({"op": "add", "path": "/fields/System.AssignedTo", "value": body.assigned_to})

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{org_url}/{body.project}/_apis/wit/workitems/${body.work_item_type}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json-patch+json",
                    "Accept": "application/json;api-version=7.1",
                },
                json=patch_doc,
            )
        if not resp.is_success:
            raise HTTPException(status_code=resp.status_code, detail=f"DevOps: {resp.text[:200]}")
        return resp.json()

    if body.action == "UPDATE_WORK_ITEM":
        if not body.work_item_id:
            raise HTTPException(status_code=400, detail="work_item_id required")
        patch_doc = []
        if body.title:
            patch_doc.append({"op": "replace", "path": "/fields/System.Title", "value": body.title})
        if body.state:
            patch_doc.append({"op": "replace", "path": "/fields/System.State", "value": body.state})
        if body.description:
            patch_doc.append({"op": "replace", "path": "/fields/System.Description", "value": body.description})
        if body.assigned_to:
            patch_doc.append({"op": "replace", "path": "/fields/System.AssignedTo", "value": body.assigned_to})

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(
                f"{org_url}/_apis/wit/workitems/{body.work_item_id}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json-patch+json",
                    "Accept": "application/json;api-version=7.1",
                },
                json=patch_doc,
            )
        return resp.json()

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")


@router.post("/webhook")
async def azure_devops_webhook(
    request: Request,
    conn: asyncpg.Connection = Depends(get_connection),
):
    """Receive Azure DevOps webhook events."""
    body = await request.json()
    event_type = body.get("eventType", "")
    logger.info(f"Azure DevOps webhook: {event_type}")

    if event_type == "workitem.updated":
        resource = body.get("resource", {})
        work_item_id = resource.get("workItemId") or resource.get("id")
        if work_item_id:
            revision = resource.get("revision", {}).get("fields", {})
            await conn.execute(
                """INSERT INTO azure_work_items (id, work_item_id, title, state, assigned_to, updated_at)
                   VALUES ($1, $2, $3, $4, $5, NOW())
                   ON CONFLICT (work_item_id) DO UPDATE SET
                       title = EXCLUDED.title, state = EXCLUDED.state,
                       assigned_to = EXCLUDED.assigned_to, updated_at = NOW()""",
                str(uuid.uuid4()), str(work_item_id),
                revision.get("System.Title"),
                revision.get("System.State"),
                revision.get("System.AssignedTo"),
            )
    return {"status": "ok"}


@router.post("/sync-work-items")
async def sync_azure_work_items(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    """Pull latest work items from Azure DevOps (runs every 10 min as background job)."""
    token_row = await _get_devops_token(current_user["id"], conn)
    if not token_row:
        return {"error": "Azure DevOps not connected", "synced": 0}

    org_url = settings.AZURE_DEVOPS_ORG_URL.rstrip("/")
    try:
        wiql_data = await _devops_request(
            "POST", f"{org_url}/_apis/wit/wiql",
            token_row["access_token"],
            json={"query": "SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.ChangedDate] >= @Today - 1 ORDER BY [System.ChangedDate] DESC"},
            params={"$top": 100},
        )
        work_items = wiql_data.get("workItems", [])
        synced = len(work_items)
        for wi in work_items:
            await conn.execute(
                """INSERT INTO sync_logs (id, integration, record_id, synced_at)
                   VALUES ($1, 'azure_devops', $2, NOW())
                   ON CONFLICT DO NOTHING""",
                str(uuid.uuid4()), str(wi["id"]),
            )
        return {"synced": synced}
    except Exception as e:
        logger.error(f"Azure DevOps sync failed: {e}")
        return {"error": str(e), "synced": 0}


@router.post("/repos-api")
async def azure_repos_api(
    body: DevOpsActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token_row = await _get_devops_token(current_user["id"], conn)
    if not token_row:
        raise HTTPException(status_code=401, detail="Azure DevOps not connected")

    org_url = settings.AZURE_DEVOPS_ORG_URL.rstrip("/")
    access_token = token_row["access_token"]

    if body.action == "LIST_REPOS":
        data = await _devops_request(
            "GET", f"{org_url}/{body.project or ''}/_apis/git/repositories", access_token
        )
        return {"repositories": data.get("value", [])}

    if body.action == "LIST_BRANCHES":
        if not body.repo:
            raise HTTPException(status_code=400, detail="repo required")
        data = await _devops_request(
            "GET", f"{org_url}/{body.project}/_apis/git/repositories/{body.repo}/refs",
            access_token, params={"filter": "heads/"},
        )
        return {"branches": data.get("value", [])}

    if body.action == "LIST_PRS":
        if not body.repo:
            raise HTTPException(status_code=400, detail="repo required")
        data = await _devops_request(
            "GET", f"{org_url}/{body.project}/_apis/git/repositories/{body.repo}/pullrequests",
            access_token, params={"searchCriteria.status": "active"},
        )
        return {"pull_requests": data.get("value", [])}

    raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")
