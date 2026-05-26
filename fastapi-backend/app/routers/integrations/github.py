"""
GitHub integration: github-api (status + PR summary from stored company token)
Tables: company_integrations
"""
import logging
from typing import Optional
from datetime import datetime, timezone, timedelta

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection

logger = logging.getLogger(__name__)
router = APIRouter(tags=["github"])

GITHUB_API = "https://api.github.com"


class GithubActionRequest(BaseModel):
    action: str = "status"


async def _get_github_token(conn: asyncpg.Connection) -> Optional[str]:
    try:
        row = await conn.fetchrow(
            "SELECT api_key FROM company_integrations WHERE integration_id = 'github' LIMIT 1"
        )
        if row:
            return row["api_key"]
    except Exception:
        pass
    try:
        row = await conn.fetchrow(
            "SELECT encrypted_api_key FROM company_integrations WHERE integration_id = 'github' LIMIT 1"
        )
        if row:
            return row["encrypted_api_key"]
    except Exception:
        pass
    return None


async def _github_get(path: str, token: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{GITHUB_API}{path}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "duncan-ai",
            },
        )
    if resp.status_code == 401:
        raise HTTPException(status_code=400, detail="GitHub token is invalid or expired")
    if resp.status_code == 403:
        raise HTTPException(status_code=400, detail="GitHub token has insufficient permissions")
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="GitHub API rate limited")
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text[:200]}")
    return resp.json()


@router.post("/github-api")
async def github_api(
    body: GithubActionRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    token = await _get_github_token(conn)
    if not token:
        return {
            "ok": True,
            "connected": False,
            "status": "not_configured",
            "error_message": "No GitHub company token stored",
        }

    try:
        await _github_get("/user", token)
    except HTTPException as e:
        return {
            "ok": True,
            "connected": False,
            "status": "degraded",
            "error_message": str(e.detail),
        }

    if body.action == "status":
        return {
            "ok": True,
            "connected": True,
            "status": "connected",
            "last_verified_at": datetime.now(timezone.utc).isoformat(),
        }

    # action == "summary" — scan up to 5 most recent repos for PR metrics
    try:
        repos = await _github_get("/user/repos?sort=updated&per_page=10", token)
    except Exception as e:
        return {"ok": True, "connected": True, "status": "degraded", "error_message": str(e)}

    open_prs = 0
    blocked_prs = 0
    stale_prs = 0
    signals = []
    stale_cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    for repo in repos[:5]:
        owner = (repo.get("owner") or {}).get("login")
        name = repo.get("name")
        if not owner or not name:
            continue
        try:
            pulls = await _github_get(f"/repos/{owner}/{name}/pulls?state=open&per_page=20", token)
            open_prs += len(pulls)
            for pr in pulls:
                updated_at_str = pr.get("updated_at") or ""
                try:
                    updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                    is_stale = updated_at < stale_cutoff
                except Exception:
                    is_stale = False

                if pr.get("draft"):
                    blocked_prs += 1
                if is_stale:
                    stale_prs += 1
                if (pr.get("draft") or is_stale) and len(signals) < 6:
                    signals.append({
                        "type": "blocked_pr" if pr.get("draft") else "stale_pr",
                        "repo": f"{owner}/{name}",
                        "label": pr.get("title") or "Untitled PR",
                    })
        except Exception as e:
            logger.warning(f"PR scan failed for {owner}/{name}: {e}")
            if len(signals) < 6:
                signals.append({"type": "repo_scan_failed", "repo": f"{owner}/{name}", "label": str(e)})

    repos_scanned = min(len(repos), 5)
    summary = (
        f"{open_prs} open PRs, {blocked_prs} blocked drafts, and {stale_prs} stale PRs "
        f"across {repos_scanned} repositories."
        if repos_scanned > 0
        else "GitHub connected but no repositories available."
    )

    return {
        "ok": True,
        "connected": True,
        "status": "connected",
        "repos_scanned": repos_scanned,
        "open_prs": open_prs,
        "blocked_prs": blocked_prs,
        "stale_prs": stale_prs,
        "release_risks": blocked_prs + stale_prs,
        "signals": signals,
        "summary": summary,
        "metrics_summary": summary,
        "last_verified_at": datetime.now(timezone.utc).isoformat(),
    }
