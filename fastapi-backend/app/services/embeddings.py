"""OpenAI text-embedding-3-small wrapper with retry and chunking."""
import asyncio
import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
MAX_CHARS = 30_000


async def embed_text(text: str, retries: int = 3) -> list[float]:
    """Generate embeddings for a single text string."""
    key = settings.OPENAI_API_KEY
    if not key:
        raise ValueError("OPENAI_API_KEY not configured")

    truncated = text[:MAX_CHARS]
    delay = 0.25

    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={"model": EMBEDDING_MODEL, "input": truncated},
                )
            if resp.status_code == 429:
                await asyncio.sleep(delay)
                delay *= 2
                continue
            if not resp.is_success:
                raise ValueError(f"Embedding API error {resp.status_code}: {resp.text[:200]}")
            return resp.json()["data"][0]["embedding"]
        except httpx.TimeoutException:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2

    raise ValueError("Embedding failed after retries")


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts."""
    key = settings.OPENAI_API_KEY
    if not key:
        raise ValueError("OPENAI_API_KEY not configured")

    truncated = [t[:MAX_CHARS] for t in texts]
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": EMBEDDING_MODEL, "input": truncated},
        )
    if not resp.is_success:
        raise ValueError(f"Embedding batch error {resp.status_code}: {resp.text[:200]}")

    data = resp.json()["data"]
    data.sort(key=lambda x: x["index"])
    return [d["embedding"] for d in data]


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into semantic chunks for embedding."""
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        start += chunk_size - overlap
    return chunks
