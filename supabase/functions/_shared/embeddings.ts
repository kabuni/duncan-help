// Centralised OpenAI embeddings helper.
// Locked to text-embedding-3-small. Adds timeout + retry. No cross-provider fallback.

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_TIMEOUT_MS = 30_000;
const EMBEDDING_MAX_ATTEMPTS = 3;

export interface EmbeddingError extends Error {
  status: number;
  code: "rate_limited" | "out_of_credits" | "invalid_request" | "upstream_error";
  retryable: boolean;
}

function classify(status: number, message: string): EmbeddingError["code"] {
  if (status === 429) return "rate_limited";
  if (status === 402 || /credit|quota|insufficient/i.test(message)) return "out_of_credits";
  if (status >= 400 && status < 500) return "invalid_request";
  return "upstream_error";
}

function makeError(status: number, message: string): EmbeddingError {
  const err = new Error(message) as EmbeddingError;
  err.status = status;
  err.code = classify(status, message);
  err.retryable = status === 0 || status === 429 || status >= 500;
  return err;
}

async function callOnce(text: string, key: string): Promise<number[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EMBEDDING_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw makeError(504, `embedding timeout after ${EMBEDDING_TIMEOUT_MS}ms`);
    throw makeError(0, e?.message || "embedding network error");
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw makeError(resp.status, `OpenAI embeddings ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw makeError(502, "embedding response missing vector");
  return vec;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw makeError(500, "OPENAI_API_KEY not configured");

  const input = (text ?? "").toString().slice(0, 30_000);
  if (!input.trim()) throw makeError(400, "empty embedding input");

  let lastErr: EmbeddingError | null = null;
  for (let attempt = 1; attempt <= EMBEDDING_MAX_ATTEMPTS; attempt++) {
    try {
      return await callOnce(input, key);
    } catch (e: any) {
      lastErr = e;
      if (!e?.retryable || attempt === EMBEDDING_MAX_ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw lastErr ?? makeError(500, "embedding failed");
}
