import { getAuthToken } from "@/lib/authStorage";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const hasExternalApiBase = typeof API_BASE === "string" && API_BASE.trim().length > 0;

function getAuthHeader(): string {
  const token = getAuthToken();
  return token ? `Bearer ${token}` : "";
}

/**
 * Call a FastAPI endpoint.
 * method: GET | POST | PUT | DELETE
 * path:   e.g. "/norman-chat"
 * body:   JSON-serialisable object (omit for GET)
 */
export async function fastApi<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  if (!hasExternalApiBase) {
    throw new Error(`External API is not configured for ${method} ${path}`);
  }
  const auth = getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`FastAPI ${method} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * When VITE_USE_FASTAPI=true, FastAPI is the primary source and there is no
 * Supabase fallback. For legacy code that still passes a supabaseCall, it is
 * simply ignored — FastAPI is always used.
 */
export async function withFastApi<T>(
  _supabaseCall: () => Promise<T>,
  fastApiCall: () => Promise<T>,
): Promise<T> {
  if (!hasExternalApiBase) {
    return _supabaseCall();
  }
  return fastApiCall();
}

export { hasExternalApiBase };
