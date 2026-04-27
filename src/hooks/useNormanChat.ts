import { useState, useCallback, useEffect, useRef } from "react";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Message = { role: "user" | "assistant"; content: string };
type Mode = "general" | "reason" | "automate" | "analyze" | "briefing";

export interface ChatAttachment {
  name: string;
  type: string;
  base64: string;
  previewUrl?: string;
  /** Populated after server-side extraction for non-image files */
  extractedText?: string;
}

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const normalizedSupabaseUrl =
  rawSupabaseUrl && rawSupabaseUrl !== "undefined" && rawSupabaseUrl !== "null"
    ? rawSupabaseUrl
    : null;
const FUNCTION_BASE_URL = normalizedSupabaseUrl
  ? `${normalizedSupabaseUrl}/functions/v1`
  : `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;
const CHAT_URL = `https://encore-catalyst-jugular.ngrok-free.dev/norman-chat`;
const EXTRACT_URL = `${FUNCTION_BASE_URL}/extract-chat-file`;
const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const FASTAPI_CHAT_URL = rawApiBaseUrl && rawApiBaseUrl !== "undefined" && rawApiBaseUrl !== "null"
  ? `${rawApiBaseUrl}/norman-chat`
  : null;
const CHAT_REQUEST_TIMEOUT_MS = 90_000;

function getChatErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Duncan took too long to respond, so the request was stopped. Please try again.";
  }

  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/** Extract text from non-image attachments via the server-side function */
async function extractFileText(
  att: ChatAttachment,
  token: string
): Promise<string> {
  const resp = await fetch(EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      file_name: att.name,
      file_type: att.type,
      base64: att.base64,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.warn(`File extraction failed for ${att.name}:`, err);
    return `[Could not extract text from ${att.name}: ${err.error || "unknown error"}]`;
  }

  const data = await resp.json();
  let result = data.text || "";
  if (data.truncated) {
    result += "\n\n[Note: File was truncated due to size. First ~50,000 characters shown.]";
  }
  return result;
}

function buildUserContent(input: string, attachments: ChatAttachment[]) {
  if (attachments.length === 0) return input;

  const parts: any[] = [{ type: "text", text: input }];

  for (const att of attachments) {
    if (att.type.startsWith("image/")) {
      // Images go as vision content directly
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${att.type};base64,${att.base64}`,
          detail: "auto",
        },
      });
    } else if (att.extractedText) {
      // Server-extracted text — clean, readable content
      parts.push({
        type: "text",
        text: `\n\n--- Attached file: ${att.name} ---\n${att.extractedText}\n--- End of file ---`,
      });
    } else {
      // Fallback: should not happen after extraction, but safety net
      parts.push({
        type: "text",
        text: `\n\n[Attached file: ${att.name} (could not be processed)]`,
      });
    }
  }

  return parts;
}

async function streamAssistantResponse(
  response: Response,
  upsertAssistant: (chunk: string) => void,
  logLabel: string,
) {
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;
  let sawContent = false;

  console.info(`[Duncan] ${logLabel}: stream opened`);

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;

      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") {
        streamDone = true;
        break;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) {
          if (!sawContent) {
            console.info(`[Duncan] ${logLabel}: first token received`);
          }
          sawContent = true;
          upsertAssistant(content);
        }
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  if (buffer.trim()) {
    for (let raw of buffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (raw.startsWith(":") || raw.trim() === "") continue;
      if (!raw.startsWith("data: ")) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) {
          if (!sawContent) {
            console.info(`[Duncan] ${logLabel}: first token received`);
          }
          sawContent = true;
          upsertAssistant(content);
        }
      } catch {
        console.warn(`[Duncan] ${logLabel}: skipped unparsable stream chunk`);
      }
    }
  }

  if (!sawContent) {
    throw new Error("Duncan returned an empty response. Please try again.");
  }

  console.info(`[Duncan] ${logLabel}: stream completed`);
}

export function useNormanChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<string | null>(null);
  const { profile } = useProfile();
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const send = useCallback(
    async (input: string, mode: Mode = "general", attachments: ChatAttachment[] = []) => {
      const userMsg: Message = { role: "user", content: input };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      let assistantSoFar = "";

      const upsertAssistant = (chunk: string) => {
        assistantSoFar += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
            );
          }
          return [...prev, { role: "assistant", content: assistantSoFar }];
        });
      };

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

        // --- Extract text from non-image attachments server-side ---
        const nonImageAtts = attachments.filter((a) => !a.type.startsWith("image/"));
        if (nonImageAtts.length > 0) {
          setExtractionProgress(`Extracting text from ${nonImageAtts.length} file(s)…`);
          await Promise.all(
            nonImageAtts.map(async (att) => {
              att.extractedText = await extractFileText(att, token);
            })
          );
          setExtractionProgress(null);
        }

        // Build the messages array for the API
        const userContent = buildUserContent(input, attachments);
        const apiMessages = [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userContent },
        ];

        const fetchChat = async (): Promise<Response> => {
          console.info(`[Duncan] chat request started mode=${mode} messages=${apiMessages.length}`);
          return await fetch(CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ messages: apiMessages, mode, userProfile: profile ?? undefined }),
            signal: controller.signal,
          });
        };

        try {
          if (FASTAPI_CHAT_URL) {
            fetch(FASTAPI_CHAT_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "ngrok-skip-browser-warning": "true",
              },
              body: JSON.stringify({
                messages: apiMessages,
                mode,
                userProfile: profile ?? undefined,
                stream: false,
              }),
            }).catch(() => {});
          }

          let resp = await fetchChat();
          if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, 1500));
            if (controller.signal.aborted) {
              throw new DOMException("Timed out", "AbortError");
            }
            resp = await fetchChat();
          }

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(
              err.error ||
                (resp.status === 429
                  ? "Rate limit exceeded. Please wait a few seconds and try again."
                  : `Request failed (${resp.status})`)
            );
          }

          await streamAssistantResponse(resp, upsertAssistant, `chat mode=${mode}`);
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch (e) {
        console.error("Duncan chat error:", e);
        if (mountedRef.current) {
          toast.error(getChatErrorMessage(e));
        }
        upsertAssistant(
          `\n\n⚠️ Error: ${getChatErrorMessage(e)}`
        );
      } finally {
        setIsLoading(false);
        setExtractionProgress(null);
      }
    },
    [messages]
  );

  const sendBriefing = useCallback(
    async (briefingData: Record<string, any>) => {
      setIsLoading(true);
      let assistantSoFar = "";

      const upsertAssistant = (chunk: string) => {
        assistantSoFar += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
            );
          }
          return [...prev, { role: "assistant", content: assistantSoFar }];
        });
      };

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

        const briefingPrompt = `Generate my personalized morning briefing. Here is the latest data from across our systems:\n\n${JSON.stringify(briefingData, null, 2)}`;

        const apiMessages = [
          { role: "user", content: briefingPrompt },
        ];

        try {
          const resp = await fetch(CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ messages: apiMessages, mode: "briefing", userProfile: profile ?? undefined }),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `Request failed (${resp.status})`);
          }

          await streamAssistantResponse(resp, upsertAssistant, "briefing");
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch (e) {
        console.error("Duncan briefing error:", e);
        if (mountedRef.current) {
          toast.error("Daily briefing could not be completed right now.");
        }
        upsertAssistant(
          `Good morning! I wasn't able to fetch your full briefing right now, but I'm here and ready to help. Ask me anything! 🐾`
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isLoading, extractionProgress, send, sendBriefing, clearMessages, setMessages };
}
