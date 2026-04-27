import { supabase } from "@/integrations/supabase/client";

const API_BASE = "https://encore-catalyst-jugular.ngrok-free.dev";
const BASE = API_BASE;
const hasExternalApiBase = true;

// FastAPI is primary whenever API_BASE is set. No separate flag required.
const USE_FASTAPI = hasExternalApiBase;

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return `Bearer ${token}`;
}

/**
 * Call a FastAPI endpoint.
 * method: GET | POST | PUT | DELETE
 * path:   e.g. "/norman-chat"
 * body:   JSON-serialisable object (omit for GET)
 * Returns parsed JSON or throws on non-2xx.
 */
export async function fastApi<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  if (!hasExternalApiBase) {
    throw new Error(`External API is not configured for ${method} ${path}`);
  }
  const auth = await getAuthHeader();
  const res = await fetch(`${BASE}${path}`, {
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
 * Fire FastAPI silently in parallel with a Supabase call.
 *
 * Behavior:
 * - Default (VITE_USE_FASTAPI !== "true"): Supabase is PRIMARY. FastAPI fires
 *   in parallel as fire-and-forget; its errors are swallowed and never affect
 *   the UI. The Supabase result (or error) is what the caller sees.
 * - When VITE_USE_FASTAPI === "true": FastAPI is PRIMARY. On FastAPI failure,
 *   the call falls back to Supabase so the UI still works.
 *
 * The wrapper is transparent: same input shape, same output shape.
 */
export async function withFastApi<T>(
  supabaseCall: () => Promise<T>,
  fastApiCall: () => Promise<T>,
): Promise<T> {
  if (!hasExternalApiBase) {
    return supabaseCall();
  }
  if (USE_FASTAPI) {
    try {
      return await fastApiCall();
    } catch (err) {
      console.warn("[FastAPI primary failed, falling back to Supabase]", err);
      return supabaseCall();
    }
  }
  // Supabase is primary; FastAPI fires in parallel (silenced)
  const fastApiPromise = fastApiCall().catch((e) => {
    console.warn("[FastAPI shadow ✗]", e);
    return null;
  });
  const [sbResult] = await Promise.allSettled([supabaseCall(), fastApiPromise]);
  if (sbResult.status === "rejected") throw sbResult.reason;
  return sbResult.value;
}

export { USE_FASTAPI };
