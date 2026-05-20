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

/** Phase 2b: pending write action surfaced for explicit user confirmation. */
export interface PendingWriteAction {
  pendingId: string;
  toolName: string;
  summary: string;
  args: any;
  state: "awaiting" | "confirming" | "executed" | "cancelled" | "failed";
  result?: any;
  error?: string;
  createdAt: number;
}

/** Phase 2b: live tool execution status, rendered as pills in the UI. */
export interface ToolStatus {
  id: string;
  name: string;
  state: "running" | "success" | "no_data" | "partial" | "error" | "timeout" | "pending_confirmation" | "circuit_open";
  error?: string;
}

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const normalizedSupabaseUrl =
  rawSupabaseUrl && rawSupabaseUrl !== "undefined" && rawSupabaseUrl !== "null"
    ? rawSupabaseUrl
    : null;
const FUNCTION_BASE_URL = normalizedSupabaseUrl
  ? `${normalizedSupabaseUrl}/functions/v1`
  : `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/norman-chat`;
const EXTRACT_URL = `${FUNCTION_BASE_URL}/extract-chat-file`;
const CONFIRM_WRITE_URL = `${FUNCTION_BASE_URL}/confirm-chat-write`;
const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const FASTAPI_SHADOW_ENABLED = import.meta.env.VITE_ENABLE_FASTAPI_SHADOW === "true";
const FASTAPI_CHAT_URL = FASTAPI_SHADOW_ENABLED && rawApiBaseUrl && rawApiBaseUrl !== "undefined" && rawApiBaseUrl !== "null"
  ? `${rawApiBaseUrl}/norman-chat`
  : null;
const HISTORY_WINDOW = 15;
const NORMAL_TIMEOUT_MS = 180_000;
const HEAVY_TIMEOUT_MS = 300_000;
const HEAVY_MODES: Mode[] = ["reason", "analyze", "automate", "briefing"];
const HEAVY_KEYWORDS = /\b(meeting|meetings|calendar|diary|availability|schedule|brief|briefing|summary|summari[sz]e|recap|workstream|kanban|overdue|tasks?|report|analy[sz]e|compare|cv|candidate|recruit|email|gmail|inbox|draft|devops|ado|basecamp)\b/i;

type TaggedController = AbortController & { wasTimeout?: boolean };

function isHeavyChatRequest(
  mode: Mode,
  input: string,
  attachments: ChatAttachment[]
): boolean {
  return (
    HEAVY_MODES.includes(mode) ||
    (input?.length ?? 0) > 300 ||
    (Array.isArray(attachments) && attachments.length > 0) ||
    HEAVY_KEYWORDS.test(input || "")
  );
}

function getChatErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "That request took longer than expected. Duncan may still be working — try again or rephrase.";
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
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${att.type};base64,${att.base64}`,
          detail: "auto",
        },
      });
    } else if (att.extractedText) {
      parts.push({
        type: "text",
        text: `\n\n--- Attached file: ${att.name} ---\n${att.extractedText}\n--- End of file ---`,
      });
    } else {
      parts.push({
        type: "text",
        text: `\n\n[Attached file: ${att.name} (could not be processed)]`,
      });
    }
  }

  return parts;
}

interface StreamHandlers {
  onContent: (chunk: string) => void;
  onDuncanEvent?: (evt: any) => void;
}

async function streamAssistantResponse(
  response: Response,
  handlers: StreamHandlers,
  logLabel: string,
) {
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;
  let sawContent = false;

  console.info(`[Duncan] ${logLabel}: stream opened`);

  const handleLine = (line: string) => {
    if (!line) return;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.startsWith(":") || line.trim() === "") return;
    if (!line.startsWith("data: ")) return;
    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") { streamDone = true; return; }
    try {
      const parsed = JSON.parse(jsonStr);
      // Phase 2b: custom Duncan SSE events for tool lifecycle + pending writes
      if (parsed && typeof parsed === "object" && typeof parsed.duncan_event === "string") {
        handlers.onDuncanEvent?.(parsed);
        return;
      }
      const content = parsed.choices?.[0]?.delta?.content as string | undefined;
      if (content) {
        if (!sawContent) console.info(`[Duncan] ${logLabel}: first token received`);
        sawContent = true;
        handlers.onContent(content);
      }
    } catch {
      // Unparsable line — swallow.
    }
  };

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      if (streamDone) break;
    }
  }

  if (buffer.trim()) {
    for (const raw of buffer.split("\n")) handleLine(raw);
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
  const [pendingWrites, setPendingWrites] = useState<PendingWriteAction[]>([]);
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const { profile } = useProfile();
  const mountedRef = useRef(true);
  const inflightControllerRef = useRef<AbortController | null>(null);
  const lastSendRef = useRef<{ input: string; mode: Mode; attachments: ChatAttachment[]; voiceMode?: boolean } | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleDuncanEvent = useCallback((evt: any) => {
    if (!evt || typeof evt !== "object") return;
    switch (evt.duncan_event) {
      case "tool_start":
        setToolStatuses((prev) => {
          if (prev.some((p) => p.id === evt.id)) return prev;
          return [...prev, { id: evt.id, name: evt.name, state: "running" }];
        });
        break;
      case "tool_end":
        setToolStatuses((prev) =>
          prev.map((p) =>
            p.id === evt.id
              ? { ...p, state: (evt.status as ToolStatus["state"]) || "success", error: evt.error }
              : p
          )
        );
        break;
      case "tool_pending":
        setPendingWrites((prev) => {
          if (prev.some((p) => p.pendingId === evt.pendingId)) return prev;
          return [
            ...prev,
            {
              pendingId: evt.pendingId,
              toolName: evt.name,
              summary: evt.summary,
              args: evt.args,
              state: "awaiting",
              createdAt: Date.now(),
            },
          ];
        });
        break;
    }
  }, []);

  const runChat = useCallback(
    async (input: string, mode: Mode, attachments: ChatAttachment[], opts: { voiceMode?: boolean }) => {
      if (inflightControllerRef.current) {
        inflightControllerRef.current.abort();
        inflightControllerRef.current = null;
      }

      lastSendRef.current = { input, mode, attachments, voiceMode: opts.voiceMode };
      setLastError(null);
      setToolStatuses([]);

      const userMsg: Message = { role: "user", content: input };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      const safeAttachments = Array.isArray(attachments) ? attachments : [];
      const heavy = isHeavyChatRequest(mode, input, safeAttachments);
      const timeoutMs = heavy ? HEAVY_TIMEOUT_MS : NORMAL_TIMEOUT_MS;

      if (heavy) {
        setExtractionProgress("Processing a complex request — this may take up to a minute...");
      }

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

      let controller: TaggedController | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        controller = new AbortController() as TaggedController;
        inflightControllerRef.current = controller;
        const timeoutId = window.setTimeout(() => {
          controller!.wasTimeout = true;
          controller!.abort();
        }, timeoutMs);

        const nonImageAtts = safeAttachments.filter((a) => !a.type.startsWith("image/"));
        if (nonImageAtts.length > 0) {
          setExtractionProgress(`Extracting text from ${nonImageAtts.length} file(s)…`);
          await Promise.all(
            nonImageAtts.map(async (att) => {
              att.extractedText = await extractFileText(att, token);
            })
          );
          setExtractionProgress(null);
        }

        const userContent = buildUserContent(input, safeAttachments);
        const apiMessages = [
          ...messages.slice(-HISTORY_WINDOW).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userContent },
        ];

        const fetchChat = async (): Promise<Response> =>
          await fetch(CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ messages: apiMessages, mode, userProfile: profile ?? undefined, voiceMode: opts.voiceMode === true }),
            signal: controller!.signal,
          });

        try {
          if (FASTAPI_CHAT_URL) {
            fetch(FASTAPI_CHAT_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "ngrok-skip-browser-warning": "true",
              },
              body: JSON.stringify({ messages: apiMessages, mode, userProfile: profile ?? undefined, stream: false }),
            }).catch(() => {});
          }

          let resp = await fetchChat();
          if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, 1500));
            if (controller!.signal.aborted) throw new DOMException("Timed out", "AbortError");
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

          await streamAssistantResponse(
            resp,
            { onContent: upsertAssistant, onDuncanEvent: handleDuncanEvent },
            `chat mode=${mode}`,
          );
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError" && !controller?.wasTimeout) {
          console.info("[Duncan] chat request superseded — silent");
          return;
        }
        console.error("Duncan chat error:", e);
        const msg = getChatErrorMessage(e);
        if (mountedRef.current) {
          toast.error(msg);
          setLastError(msg);
        }
        upsertAssistant(`\n\n⚠️ Error: ${msg}`);
      } finally {
        setIsLoading(false);
        setExtractionProgress(null);
      }
    },
    [messages, profile, handleDuncanEvent]
  );

  const send = useCallback(
    (input: string, mode: Mode = "general", attachments: ChatAttachment[] = [], opts: { voiceMode?: boolean } = {}) =>
      runChat(input, mode, attachments, opts),
    [runChat]
  );

  const retryLastTurn = useCallback(async () => {
    const last = lastSendRef.current;
    if (!last) return;
    // Drop trailing assistant error bubble + the last user message we will re-send
    setMessages((prev) => {
      const next = [...prev];
      if (next.length && next[next.length - 1].role === "assistant") next.pop();
      if (next.length && next[next.length - 1].role === "user" && next[next.length - 1].content === last.input) next.pop();
      return next;
    });
    await runChat(last.input, last.mode, last.attachments, { voiceMode: last.voiceMode });
  }, [runChat]);

  const callConfirmEndpoint = useCallback(
    async (pendingId: string, action: "confirm" | "cancel") => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(CONFIRM_WRITE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pendingId, action }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Confirmation failed (${resp.status})`);
      return data;
    },
    []
  );

  const confirmWrite = useCallback(
    async (pendingId: string) => {
      setPendingWrites((prev) => prev.map((p) => (p.pendingId === pendingId ? { ...p, state: "confirming" } : p)));
      try {
        const data = await callConfirmEndpoint(pendingId, "confirm");
        setPendingWrites((prev) =>
          prev.map((p) => (p.pendingId === pendingId ? { ...p, state: "executed", result: data?.result } : p))
        );
        toast.success("Action confirmed and executed.");
      } catch (e: any) {
        const msg = e?.message || "Confirmation failed";
        setPendingWrites((prev) =>
          prev.map((p) => (p.pendingId === pendingId ? { ...p, state: "failed", error: msg } : p))
        );
        toast.error(msg);
      }
    },
    [callConfirmEndpoint]
  );

  const cancelWrite = useCallback(
    async (pendingId: string) => {
      try {
        await callConfirmEndpoint(pendingId, "cancel");
        setPendingWrites((prev) =>
          prev.map((p) => (p.pendingId === pendingId ? { ...p, state: "cancelled" } : p))
        );
        toast("Action cancelled.");
      } catch (e: any) {
        toast.error(e?.message || "Cancel failed");
      }
    },
    [callConfirmEndpoint]
  );

  const sendBriefing = useCallback(
    async (briefingData: Record<string, any>): Promise<boolean> => {
      setIsLoading(true);
      let assistantSoFar = "";
      let success = false;

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
        const timeoutId = window.setTimeout(() => controller.abort(), HEAVY_TIMEOUT_MS);

        const briefingPrompt = `Generate my personalized morning briefing. Here is the latest data from across our systems:\n\n${JSON.stringify(briefingData, null, 2)}`;
        const apiMessages = [{ role: "user", content: briefingPrompt }];

        try {
          const resp = await fetch(CHAT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ messages: apiMessages, mode: "briefing", userProfile: profile ?? undefined }),
            signal: controller.signal,
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `Request failed (${resp.status})`);
          }
          await streamAssistantResponse(resp, { onContent: upsertAssistant, onDuncanEvent: handleDuncanEvent }, "briefing");
          success = true;
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch (e) {
        console.error("[Duncan] briefing: failure reason →", e);
        if (mountedRef.current) toast.error("Daily briefing could not be completed right now.");
      } finally {
        setIsLoading(false);
      }

      return success;
    },
    [profile, handleDuncanEvent]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setPendingWrites([]);
    setToolStatuses([]);
    setLastError(null);
  }, []);

  return {
    messages,
    isLoading,
    extractionProgress,
    pendingWrites,
    toolStatuses,
    lastError,
    send,
    sendBriefing,
    clearMessages,
    setMessages,
    confirmWrite,
    cancelWrite,
    retryLastTurn,
  };
}
