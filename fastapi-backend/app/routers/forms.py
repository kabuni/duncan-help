"""
Google Forms integration: parse-google-form, submit-google-form
No DB tables — pure HTTP proxy with security validation.
"""
import re
import json
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["forms"])

ALLOWED_FORM_HOSTS = {"docs.google.com", "forms.gle"}


class ParseFormRequest(BaseModel):
    formUrl: str


class SubmitFormRequest(BaseModel):
    formActionUrl: str
    entries: dict


@router.post("/parse-google-form")
async def parse_google_form(
    body: ParseFormRequest,
    current_user: dict = Depends(get_current_user),
):
    url = body.formUrl.strip()
    if not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Only HTTPS Google Form URLs are accepted")

    from urllib.parse import urlparse
    host = urlparse(url).netloc.lower().lstrip("www.")
    if host not in ALLOWED_FORM_HOSTS:
        raise HTTPException(status_code=400, detail="Only Google Forms URLs are supported")

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if not resp.is_success:
            raise HTTPException(status_code=400, detail=f"Failed to fetch form: HTTP {resp.status_code}")

        html = resp.text

        # Extract title
        title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        form_title = title_match.group(1).replace(" - Google Forms", "").strip() if title_match else "Google Form"

        # Try to extract FB_PUBLIC_LOAD_DATA_ JSON
        fields = []
        data_match = re.search(r"FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.+?\]);\s*</script>", html, re.DOTALL)
        if data_match:
            try:
                data = json.loads(data_match.group(1))
                # Field data lives at data[1][1]
                raw_fields = (data[1][1] if len(data) > 1 and data[1] and len(data[1]) > 1 else []) or []
                for field in raw_fields:
                    if not isinstance(field, list) or len(field) < 2:
                        continue
                    field_title = field[1] if isinstance(field[1], str) else ""
                    field_type_raw = field[3] if len(field) > 3 else 0
                    entry_id = None
                    required = False
                    options = []

                    if len(field) > 4 and isinstance(field[4], list):
                        for item in field[4]:
                            if isinstance(item, list) and len(item) > 0:
                                entry_id = item[0] if isinstance(item[0], int) else None
                                required = bool(item[2]) if len(item) > 2 else False
                                if len(item) > 1 and isinstance(item[1], list):
                                    options = [o[0] for o in item[1] if isinstance(o, list) and o]

                    type_map = {0: "short_text", 1: "paragraph", 2: "multiple_choice",
                                3: "dropdown", 4: "checkbox", 5: "linear_scale",
                                7: "grid", 9: "date", 10: "time"}
                    field_type = type_map.get(field_type_raw, "unknown")

                    if field_title:
                        fields.append({
                            "title": field_title,
                            "type": field_type,
                            "required": required,
                            "entry_id": f"entry.{entry_id}" if entry_id else None,
                            "options": options,
                        })
            except Exception as e:
                logger.warning(f"Failed to parse FB_PUBLIC_LOAD_DATA_: {e}")

        if not fields:
            # Fallback regex parsing
            for match in re.finditer(r'entry\.(\d+)', html):
                entry_id = match.group(1)
                if not any(f.get("entry_id") == f"entry.{entry_id}" for f in fields):
                    fields.append({"entry_id": f"entry.{entry_id}", "type": "unknown", "required": False, "options": []})

        return {"title": form_title, "fields": fields, "field_count": len(fields)}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"parse-google-form error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse form: {str(e)[:200]}")


@router.post("/submit-google-form")
async def submit_google_form(
    body: SubmitFormRequest,
    current_user: dict = Depends(get_current_user),
):
    action_url = body.formActionUrl.strip()

    from urllib.parse import urlparse
    host = urlparse(action_url).netloc.lower().lstrip("www.")
    if host not in ALLOWED_FORM_HOSTS and "docs.google.com" not in host:
        raise HTTPException(status_code=400, detail="Only Google Forms submission URLs are allowed")

    if not action_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Form action URL must be HTTPS")

    # Enforce payload size limit (approx 10KB)
    payload_str = json.dumps(body.entries)
    if len(payload_str) > 10_000:
        raise HTTPException(status_code=400, detail="Form payload too large")

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            resp = await client.post(
                action_url,
                data=body.entries,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        return {
            "submitted": True,
            "status_code": resp.status_code,
            "redirected": resp.status_code in (301, 302, 303),
        }
    except Exception as e:
        logger.error(f"submit-google-form error: {e}")
        raise HTTPException(status_code=500, detail=f"Form submission failed: {str(e)[:200]}")
