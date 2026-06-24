// Shared LLM router for Duncan edge functions.
// Routes calls between OpenAI and Anthropic (Claude) with cross-provider fallback.
// Normalises both APIs to the OpenAI chat-completions response shape so callers
// don't need to change their existing parsing logic.

export type Provider = "openai" | "claude";

export type WorkflowName =
  | "norman-chat"
  | "ceo-briefing"
  | "ceo-email-pulse"
  | "analyze-meeting"
  | "finalize-release"
  | "generate-exec-summary"
  | "score-cv-values"
  | "score-cv-competencies"
  | "generate-jd"
  | "parse-jd-competencies"
  | "gmail-auto-draft"
  | "gmail-train-style"
  | "chat-with-project-context"
  | "extract-chat-file"
  | "extract-file-text"
  | "parse-cv"
  | "hireflix-sync-interviews"
  | "hireflix-retry-processor"
  | "create-hireflix-position"
  | "google-analytics"
  | "claude-test"
  | "generic";

// `locked: true` means cross-provider fallback is forbidden for this workflow.
// We still attempt a single same-provider retry and a model degrade before giving up.
export const WORKFLOW_ROUTING: Record<WorkflowName, { primary: Provider; fallback: Provider; locked?: boolean }> = {
  // LOCKED — streaming chat must stay on OpenAI
  "norman-chat":               { primary: "openai", fallback: "openai", locked: true },
  "chat-with-project-context": { primary: "openai", fallback: "openai", locked: true },

  // LOCKED — Duncan voice/style fidelity
  "gmail-auto-draft":          { primary: "claude", fallback: "claude", locked: true },
  "gmail-train-style":         { primary: "claude", fallback: "claude", locked: true },

  // Claude primary (long-form synthesis, executive writing, scoring)
  "ceo-briefing":              { primary: "claude", fallback: "openai" },
  "ceo-email-pulse":           { primary: "claude", fallback: "openai" },
  "analyze-meeting":           { primary: "claude", fallback: "openai" },
  "finalize-release":          { primary: "claude", fallback: "openai" },
  "generate-exec-summary":     { primary: "claude", fallback: "openai" },
  "hireflix-sync-interviews":  { primary: "claude", fallback: "openai" },
  "hireflix-retry-processor":  { primary: "claude", fallback: "openai" },
  "create-hireflix-position":  { primary: "claude", fallback: "openai" },
  "score-cv-values":           { primary: "claude", fallback: "openai" },
  "score-cv-competencies":     { primary: "claude", fallback: "openai" },
  "claude-test":               { primary: "claude", fallback: "openai" },

  // OpenAI primary (structured JSON / tool calling / file extraction)
  "generate-jd":               { primary: "openai", fallback: "claude" },
  "parse-jd-competencies":     { primary: "openai", fallback: "claude" },
  "extract-chat-file":         { primary: "openai", fallback: "claude" },
  "extract-file-text":         { primary: "openai", fallback: "claude" },
  "parse-cv":                  { primary: "openai", fallback: "claude" },
  "google-analytics":          { primary: "openai", fallback: "claude" },

  generic:                     { primary: "openai", fallback: "claude" },
};

// Per-workflow primary-model overrides. When set, this model is used as the
// primary attempt instead of the provider default. Degrade still falls to the
// provider's degrade model.
const WORKFLOW_PRIMARY_MODEL: Partial<Record<WorkflowName, { openai?: string; claude?: string }>> = {
  "parse-cv":              { openai: "gpt-5-mini" },
  "parse-jd-competencies": { openai: "gpt-5-mini" },
  "extract-file-text":     { openai: "gpt-5-mini" },
  "extract-chat-file":     { openai: "gpt-5-mini" },
  "google-analytics":      { openai: "gpt-5-mini" },
  "score-cv-values":       { claude: "claude-haiku-4-5" },
  "score-cv-competencies": { claude: "claude-haiku-4-5" },
};

// Sonnet stays primary on synchronous workflows: Opus 4.5 averages 150-180s on
// briefing-grade synthesis, which exceeds the edge runtime HTTP timeout.
// Promote Opus only behind a background-task pattern (EdgeRuntime.waitUntil).
const CLAUDE_MODEL_PRIMARY = "claude-sonnet-4-5-20250929";
const CLAUDE_MODEL_DEGRADE = "claude-haiku-4-5";
const OPENAI_MODEL_PRIMARY = "gpt-5";
const OPENAI_MODEL_DEGRADE = "gpt-5-mini";

// Per-attempt provider timeout. If the LLM doesn't respond in this window we
// abort and let callLLMWithFallback try the other provider.
// Default 60s. ceo-briefing runs in a background task (EdgeRuntime.waitUntil)
// and needs more headroom because Sonnet 4.5 averages 90-180s on the briefing
// prompt; the per-workflow override below is consulted at call time.
const PROVIDER_TIMEOUT_MS_DEFAULT = 60_000;
const PROVIDER_TIMEOUT_OVERRIDES: Partial<Record<WorkflowName, number>> = {
  // 240s headroom — Sonnet 4.5 with 8192-token output runs 100-200s on the briefing prompt.
  "ceo-briefing": 240_000,
};
function timeoutFor(workflow: WorkflowName): number {
  return PROVIDER_TIMEOUT_OVERRIDES[workflow] ?? PROVIDER_TIMEOUT_MS_DEFAULT;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: any;
  // OpenAI tool-call / tool-response fields, preserved through router
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: any;
  };
}

export interface CallLLMOptions {
  workflow: WorkflowName;
  messages: LLMMessage[];
  tools?: LLMTool[];
  tool_choice?: any;
  max_tokens?: number;
  temperature?: number;
  response_format?: any;
  // Force a provider (skips fallback). Used for testing.
  force_provider?: Provider;
  // Override model per provider.
  model_override?: { openai?: string; claude?: string };
}

export interface NormalisedResponse {
  // OpenAI-shaped: { choices: [{ message: { content, tool_calls } }] }
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  _provider: Provider;
  _model: string;
}

function extractJsonCandidate(raw: string): string {
  const withoutFences = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  const objectStart = withoutFences.indexOf("{");
  const arrayStart = withoutFences.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);

  if (starts.length === 0) return withoutFences;
  return withoutFences.slice(Math.min(...starts));
}

function repairJsonCandidate(raw: string): string {
  const input = extractJsonCandidate(raw)
    .replace(/[“”]/g, '"')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  let output = "";
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of input) {
    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }

    if (ch === "{") closers.push("}");
    if (ch === "[") closers.push("]");

    if (ch === "}" || ch === "]") {
      const expected = closers[closers.length - 1];
      if (!expected) continue;
      while (closers.length > 0 && closers[closers.length - 1] !== ch) {
        output += closers.pop();
      }
      if (closers[closers.length - 1] === ch) {
        closers.pop();
      }
    }

    output += ch;
  }

  if (inString) output += '"';
  output = output.replace(/,\s*([}\]])/g, "$1");
  while (closers.length > 0) output += closers.pop();
  return output.trim();
}

function parseToolArgumentsLoosely(raw: unknown): any {
  if (raw == null) return {};
  if (typeof raw !== "string") return raw;

  const trimmed = raw.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    return JSON.parse(repairJsonCandidate(trimmed));
  }
}

function log(workflow: string, provider: Provider, attempt: number, status: string, latencyMs: number, extra?: string) {
  const tail = extra ? ` ${extra}` : "";
  console.log(`[llm] workflow=${workflow} provider=${provider} attempt=${attempt} status=${status} latency_ms=${latencyMs}${tail}`);
}

// ---------- OpenAI ----------

async function callOpenAI(opts: CallLLMOptions, model: string): Promise<NormalisedResponse> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const body: any = {
    model,
    messages: opts.messages,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.max_tokens) {
    // GPT-5 family rejects max_tokens; use max_completion_tokens.
    if (model.startsWith("gpt-5")) body.max_completion_tokens = opts.max_tokens;
    else body.max_tokens = opts.max_tokens;
  }
  // GPT-5 family only supports default temperature (1); omit if caller passed a custom value.
  if (opts.temperature !== undefined && !model.startsWith("gpt-5")) body.temperature = opts.temperature;
  if (opts.response_format) body.response_format = opts.response_format;

  const ctrl = new AbortController();
  const timeoutMs = timeoutFor(opts.workflow);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      const err: any = new Error(`OpenAI timeout after ${timeoutMs}ms`);
      err.status = 504;
      err.timeout = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(`OpenAI ${resp.status}: ${text.slice(0, 300)}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  return { ...data, _provider: "openai", _model: model };
}

// ---------- Anthropic / Claude ----------

function toAnthropicMessages(messages: LLMMessage[]): { system?: string; messages: any[] } {
  let system: string | undefined;
  const out: any[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      system = system ? `${system}\n\n${content}` : content;
      continue;
    }

    if (m.role === "tool") {
      // OpenAI tool result → Anthropic user message containing tool_result block
      out.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }],
      });
      continue;
    }

    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      const blocks: any[] = [];
      if (typeof m.content === "string" && m.content.trim()) {
        blocks.push({ type: "text", text: m.content });
      }
      for (const tc of m.tool_calls) {
        let input: any = {};
        try { input = parseToolArgumentsLoosely(tc.function.arguments); }
        catch { input = {}; }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    // user / assistant plain
    out.push({
      role: m.role,
      content: typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content) ? m.content : JSON.stringify(m.content),
    });
  }

  return { system, messages: out };
}

function toAnthropicTools(tools?: LLMTool[]): any[] | undefined {
  if (!tools) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters,
  }));
}

function toAnthropicToolChoice(tc?: any): any | undefined {
  if (!tc) return undefined;
  if (tc === "auto") return { type: "auto" };
  if (tc === "none") return undefined;
  if (tc === "required") return { type: "any" };
  if (typeof tc === "object" && tc.type === "function") {
    return { type: "tool", name: tc.function?.name };
  }
  return undefined;
}

function fromAnthropicResponse(data: any, model: string): NormalisedResponse {
  const blocks = Array.isArray(data.content) ? data.content : [];
  let text = "";
  const tool_calls: any[] = [];

  for (const b of blocks) {
    if (b.type === "text") text += b.text;
    else if (b.type === "tool_use") {
      tool_calls.push({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      });
    }
  }

  const finish = data.stop_reason === "tool_use" ? "tool_calls"
               : data.stop_reason === "end_turn" ? "stop"
               : data.stop_reason === "max_tokens" ? "length"
               : (data.stop_reason || "stop");

  return {
    choices: [{
      message: {
        role: "assistant",
        content: text || null,
        ...(tool_calls.length ? { tool_calls } : {}),
      },
      finish_reason: finish,
    }],
    usage: data.usage ? {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
    } : undefined,
    _provider: "claude",
    _model: model,
  };
}

async function callClaude(opts: CallLLMOptions, model: string): Promise<NormalisedResponse> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const { system, messages } = toAnthropicMessages(opts.messages);
  const body: any = {
    model,
    max_tokens: opts.max_tokens ?? 4096,
    messages,
  };
  if (system) body.system = system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const tools = toAnthropicTools(opts.tools);
  if (tools) body.tools = tools;
  const tc = toAnthropicToolChoice(opts.tool_choice);
  if (tc) body.tool_choice = tc;

  const ctrl = new AbortController();
  const timeoutMs = timeoutFor(opts.workflow);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      const err: any = new Error(`Anthropic timeout after ${timeoutMs}ms`);
      err.status = 504;
      err.timeout = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(`Anthropic ${resp.status}: ${text.slice(0, 300)}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  return fromAnthropicResponse(data, model);
}

// ---------- Public API ----------

function pickModel(provider: Provider, opts: CallLLMOptions, degrade = false): string {
  if (opts.model_override?.[provider]) return opts.model_override[provider]!;
  if (!degrade) {
    const wf = WORKFLOW_PRIMARY_MODEL[opts.workflow]?.[provider];
    if (wf) return wf;
  }
  if (provider === "claude") return degrade ? CLAUDE_MODEL_DEGRADE : CLAUDE_MODEL_PRIMARY;
  return degrade ? OPENAI_MODEL_DEGRADE : OPENAI_MODEL_PRIMARY;
}

async function callProvider(provider: Provider, opts: CallLLMOptions, degrade = false): Promise<NormalisedResponse> {
  const model = pickModel(provider, opts, degrade);
  if (provider === "claude") return await callClaude(opts, model);
  return await callOpenAI(opts, model);
}

function isClaudeBillingOrQuotaError(provider: Provider, status: number | undefined, message: string): boolean {
  if (provider !== "claude" || status !== 400) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("credit balance")
    || normalized.includes("insufficient")
    || normalized.includes("quota");
}

export type LLMErrorCode = "rate_limited" | "out_of_credits" | "invalid_request" | "upstream_error";
export interface StructuredLLMError extends Error {
  status: number;
  code: LLMErrorCode;
  retryable: boolean;
  provider?: Provider;
}

export function classifyLLMError(provider: Provider, status: number | undefined, message: string): StructuredLLMError {
  const s = status ?? 0;
  const billing = isClaudeBillingOrQuotaError(provider, s, message);
  let code: LLMErrorCode;
  if (s === 429) code = "rate_limited";
  else if (billing || s === 402) code = "out_of_credits";
  else if (s >= 400 && s < 500) code = "invalid_request";
  else code = "upstream_error";
  // Same-provider retryable: 5xx, network, 429
  const retryable = s === 0 || s === 429 || s >= 500;
  const err = new Error(message) as StructuredLLMError;
  err.status = s;
  err.code = code;
  err.retryable = retryable;
  err.provider = provider;
  return err;
}

function shouldSameProviderRetry(status?: number): boolean {
  if (!status) return true;
  return status === 429 || status >= 500;
}

function shouldCrossProviderFallback(provider: Provider, status?: number, message = ""): boolean {
  if (!status) return true;
  if (isClaudeBillingOrQuotaError(provider, status, message)) return true;
  if (status >= 400 && status < 500) return false; // other 4xx → no fallback
  return status === 429 || status >= 500;
}

function isEmpty(res: NormalisedResponse): boolean {
  return !res.choices?.[0]?.message?.content && !res.choices?.[0]?.message?.tool_calls?.length;
}

/** Single-shot call without fallback. */
export async function callLLM(opts: CallLLMOptions): Promise<NormalisedResponse> {
  const route = WORKFLOW_ROUTING[opts.workflow] ?? WORKFLOW_ROUTING.generic;
  const provider = opts.force_provider ?? route.primary;
  const start = Date.now();
  try {
    const res = await callProvider(provider, opts);
    log(opts.workflow, provider, 1, "ok", Date.now() - start);
    return res;
  } catch (err: any) {
    log(opts.workflow, provider, 1, "fail", Date.now() - start, `error="${(err?.message || "").slice(0, 120)}"`);
    throw classifyLLMError(provider, err?.status, err?.message || String(err));
  }
}

/**
 * Call sequence:
 *   1. primary (full model)
 *   2. primary same-provider retry (5xx / 429 / network only)
 *   3. primary degraded model (mini / haiku)
 *   4. cross-provider fallback (skipped if route.locked, blocked for non-billing 4xx)
 */
export async function callLLMWithFallback(opts: CallLLMOptions): Promise<NormalisedResponse> {
  const route = WORKFLOW_ROUTING[opts.workflow] ?? WORKFLOW_ROUTING.generic;
  const primary = opts.force_provider ?? route.primary;
  const locked = !!route.locked || !!opts.force_provider;
  const fallback: Provider = primary === "claude" ? "openai" : "claude";

  const tryAttempt = async (
    provider: Provider,
    attempt: number,
    degrade: boolean,
  ): Promise<NormalisedResponse> => {
    const t = Date.now();
    const res = await callProvider(provider, opts, degrade);
    if (isEmpty(res)) throw Object.assign(new Error("empty response"), { status: 502 });
    log(opts.workflow, provider, attempt, "ok", Date.now() - t, degrade ? "degraded" : undefined);
    return res;
  };

  // Attempt 1: primary, full model
  let lastErr: any;
  try {
    return await tryAttempt(primary, 1, false);
  } catch (err: any) {
    lastErr = err;
    log(opts.workflow, primary, 1, "fail", 0, `status=${err?.status}`);
    if (!shouldSameProviderRetry(err?.status) && !shouldCrossProviderFallback(primary, err?.status, err?.message || "")) {
      throw classifyLLMError(primary, err?.status, err?.message || "");
    }
  }

  // Attempt 2: same provider retry
  if (shouldSameProviderRetry(lastErr?.status)) {
    try {
      return await tryAttempt(primary, 2, false);
    } catch (err: any) {
      lastErr = err;
      log(opts.workflow, primary, 2, "fail", 0, `status=${err?.status}`);
    }
  }

  // Attempt 3: same provider, degraded model
  try {
    return await tryAttempt(primary, 3, true);
  } catch (err: any) {
    lastErr = err;
    log(opts.workflow, primary, 3, "fail", 0, `status=${err?.status} degraded`);
  }

  // Attempt 4: cross-provider fallback (locked workflows stop here)
  if (locked || !shouldCrossProviderFallback(primary, lastErr?.status, lastErr?.message || "")) {
    throw classifyLLMError(primary, lastErr?.status, lastErr?.message || "");
  }
  try {
    return await tryAttempt(fallback, 4, false);
  } catch (err: any) {
    log(opts.workflow, fallback, 4, "fail", 0, `status=${err?.status}`);
    throw classifyLLMError(fallback, err?.status, err?.message || "");
  }
}


/**
 * Streaming chat. OpenAI-only by policy. No cross-provider fallback (streams
 * cannot be rewound once forwarded). Uses first-chunk buffering: we wait for
 * the first SSE byte (with timeout) before returning the stream so transient
 * upstream failures surface as a normal error instead of a half-open stream.
 */
const STREAM_FIRST_CHUNK_TIMEOUT_MS = 30_000;

export async function streamLLM(opts: CallLLMOptions): Promise<ReadableStream<Uint8Array>> {
  // Force OpenAI for streaming regardless of route.
  const provider: Provider = "openai";
  const start = Date.now();
  try {
    const stream = await openaiStream(opts, pickModel("openai", opts));
    const buffered = await bufferFirstChunk(stream, STREAM_FIRST_CHUNK_TIMEOUT_MS);
    log(opts.workflow, provider, 1, "ok", Date.now() - start, "stream=open");
    return buffered;
  } catch (err: any) {
    log(opts.workflow, provider, 1, "fail", Date.now() - start, `status=${err?.status}`);
    throw classifyLLMError(provider, err?.status, err?.message || String(err));
  }
}

/**
 * Reads up to the first non-empty chunk from `source` (with a timeout) and
 * returns a new ReadableStream that replays it followed by the remaining
 * source. If no chunk arrives in time, aborts and throws.
 */
async function bufferFirstChunk(
  source: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStream<Uint8Array>> {
  const reader = source.getReader();
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(Object.assign(new Error("stream first-chunk timeout"), { status: 504 })), timeoutMs),
  );
  let first: ReadableStreamReadResult<Uint8Array>;
  try {
    first = await Promise.race([reader.read(), timer]);
  } catch (err: any) {
    try { await reader.cancel(); } catch { /* ignore */ }
    throw err;
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) {
        controller.close();
        return;
      }
      controller.enqueue(first.value);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        controller.enqueue(value);
      } catch (err: any) {
        controller.error(err);
      }
    },
    cancel() { try { reader.cancel(); } catch { /* ignore */ } },
  });
}

async function openaiStream(opts: CallLLMOptions, model: string): Promise<ReadableStream<Uint8Array>> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const body: any = {
    model,
    messages: opts.messages,
    stream: true,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.max_tokens) {
    if (model.startsWith("gpt-5")) body.max_completion_tokens = opts.max_tokens;
    else body.max_tokens = opts.max_tokens;
  }
  if (opts.temperature !== undefined && !model.startsWith("gpt-5")) body.temperature = opts.temperature;

  // Streaming callers must never wait indefinitely for OpenAI to accept the
  // request. Without this, a slow first byte can hold the edge request open
  // until the platform's 150s idle timeout and surface as a 504 to the UI.
  const ctrl = new AbortController();
  const openTimeoutMs = STREAM_FIRST_CHUNK_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), openTimeoutMs);
  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      const err: any = new Error(`OpenAI stream open timeout after ${openTimeoutMs}ms`);
      err.status = 504;
      err.timeout = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(`OpenAI stream ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.body;
}

