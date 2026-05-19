"""
ElevenLabs integration: elevenlabs-tts, elevenlabs-scribe-token
Server issues single-use session tokens — API key never exposed to browser.
"""
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["elevenlabs"])

ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"


class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = "21m00Tcm4TlvDq8ikWAM"  # Rachel voice
    model_id: str = "eleven_multilingual_v2"
    stability: float = 0.5
    similarity_boost: float = 0.75


@router.post("/elevenlabs-tts")
async def elevenlabs_tts(
    body: TTSRequest,
    current_user: dict = Depends(get_current_user),
):
    """Generate speech audio from text. Returns audio/mpeg bytes."""
    api_key = settings.ELEVENLABS_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")

    if len(body.text) > 5000:
        raise HTTPException(status_code=400, detail="Text too long (max 5000 chars)")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{ELEVENLABS_API_BASE}/text-to-speech/{body.voice_id}",
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json={
                "text": body.text,
                "model_id": body.model_id,
                "voice_settings": {
                    "stability": body.stability,
                    "similarity_boost": body.similarity_boost,
                },
            },
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"ElevenLabs error: {resp.text[:200]}")

    return Response(
        content=resp.content,
        media_type="audio/mpeg",
        headers={"Content-Length": str(len(resp.content))},
    )


@router.post("/elevenlabs-scribe-token")
async def elevenlabs_scribe_token(current_user: dict = Depends(get_current_user)):
    """
    Issue a single-use signed URL / session token for ElevenLabs Conversational AI (Scribe).
    The API key is never sent to the browser.
    """
    api_key = settings.ELEVENLABS_API_KEY
    agent_id = settings.ELEVENLABS_AGENT_ID
    if not api_key or not agent_id:
        raise HTTPException(status_code=503, detail="ElevenLabs not configured")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{ELEVENLABS_API_BASE}/convai/conversation/get_signed_url",
            headers={"xi-api-key": api_key},
            params={"agent_id": agent_id},
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=f"ElevenLabs error: {resp.text[:200]}")

    data = resp.json()
    return {"signed_url": data.get("signed_url")}


@router.get("/elevenlabs-voices")
async def elevenlabs_voices(current_user: dict = Depends(get_current_user)):
    """List available ElevenLabs voices."""
    api_key = settings.ELEVENLABS_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{ELEVENLABS_API_BASE}/voices",
            headers={"xi-api-key": api_key},
        )
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail="Failed to fetch voices")
    return resp.json()
