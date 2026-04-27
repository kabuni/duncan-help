import { supabase } from "@/integrations/supabase/client";

const NORMAN_CHAT_URL = "https://encore-catalyst-jugular.ngrok-free.dev/norman-chat";

/**
 * SSE streaming chat endpoint.
 * Returns a raw Response so the caller can consume the ReadableStream.
 */
export const streamChat = async (body: {
  messages: Array<{ role: string; content: unknown }>;
  mode?: string;
  userProfile?: Record<string, unknown>;
}): Promise<Response> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(NORMAN_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API stream /norman-chat failed (${res.status}): ${text}`);
  }
  return res;
};
