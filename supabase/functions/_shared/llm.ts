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
  | "generic";

export const WORKFLOW_ROUTING: Record<WorkflowName, { primary: Provider; fallback: Provider }> = {
  // Claude primary (reasoning, synthesis, writing)
  "norman-chat":               { primary: "openai", fallback: "openai" },
  "ceo-briefing":              { primary: "claude", fallback: "openai" },
  "ceo-email-pulse":           { primary: "claude", fallback: "openai" },
  "analyze-meeting":           { primary: "claude", fallback: "openai" },
  "finalize-release":          { primary: "claude", fallback: "openai" },
  "generate-exec-summary":     { primary: "claude", fallback: "openai" },
  "score-cv-values":           { primary: "claude", fallback: "openai" },
  "score-cv-competencies":     { primary: "claude", fallback: "openai" },
  "generate-jd":               { primary: "claude", fallback: "openai" },
  "parse-jd-competencies":     { primary: "claude", fallback: "openai" },
  "gmail-auto-draft":          { primary: "claude", fallback: "openai" },
  "gmail-train-style":         { primary: "claude", fallback: "openai" },
  "chat-with-project-context": { primary: "claude", fallback: "openai" },
  "hireflix-sync-interviews":  { primary: "claude", fallback: "openai" },
  "hireflix-retry-processor":  { primary: "claude", fallback: "openai" },
  "create-hireflix-position":  { primary: "claude", fallback: "openai" },

  // OpenAI primary (vision, structured extraction from raw files)
  "extract-chat-file":         { primary: "openai", fallback: "claude" },
  "extract-file-text":         { primary: "openai", fallback: "claude" },
  "parse-cv":                  { primary: "openai", fallback: "claude" },

  generic:                     { primary: "claude", fallback: "openai" },
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
  if (provider === "claude") return degrade ? CLAUDE_MODEL_DEGRADE : CLAUDE_MODEL_PRIMARY;
  return degrade ? OPENAI_MODEL_DEGRADE : OPENAI_MODEL_PRIMARY;
}

async function callProvider(provider: Provider, opts: CallLLMOptions, degrade = false): Promise<NormalisedResponse> {
  const model = pickModel(provider, opts, degrade);
  if (provider === "claude") return await callClaude(opts, model);
  return await callOpenAI(opts, model);
}

function isRetryable(status?: number): boolean {
  if (!status) return true; // network error
  return status === 429 || status >= 500;
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
    throw err;
  }
}

/** Call with cross-provider fallback on 429 / 5xx / network / empty response. */
export async function callLLMWithFallback(opts: CallLLMOptions): Promise<NormalisedResponse> {
  const route = WORKFLOW_ROUTING[opts.workflow] ?? WORKFLOW_ROUTING.generic;
  const primary = opts.force_provider ?? route.primary;
  const fallback: Provider = primary === "claude" ? "openai" : "claude";

  // Attempt 1: primary
  const t1 = Date.now();
  try {
    const res = await callProvider(primary, opts);
    const empty = !res.choices?.[0]?.message?.content && !res.choices?.[0]?.message?.tool_calls?.length;
    if (empty) throw Object.assign(new Error("empty response"), { status: 500 });
    log(opts.workflow, primary, 1, "ok", Date.now() - t1);
    return res;
  } catch (err: any) {
    const status = err?.status;
    if (opts.force_provider || !isRetryable(status)) {
      log(opts.workflow, primary, 1, "fail", Date.now() - t1, `status=${status} error="${(err?.message || "").slice(0, 120)}"`);
      throw err;
    }
    log(opts.workflow, primary, 1, "fallback", Date.now() - t1, `status=${status}`);
  }

  // Attempt 2: fallback provider
  const t2 = Date.now();
  try {
    const res = await callProvider(fallback, opts);
    const empty = !res.choices?.[0]?.message?.content && !res.choices?.[0]?.message?.tool_calls?.length;
    if (empty) throw Object.assign(new Error("empty response"), { status: 500 });
    log(opts.workflow, fallback, 2, "ok", Date.now() - t2);
    return res;
  } catch (err: any) {
    log(opts.workflow, fallback, 2, "fail", Date.now() - t2, `status=${err?.status} error="${(err?.message || "").slice(0, 120)}"`);
    throw err;
  }
}

/**
 * Streaming chat. Always emits OpenAI-shaped SSE lines:
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: {"choices":[{"delta":{"tool_calls":[...]}}]}
 *   data: [DONE]
 * so existing frontend parsers keep working unchanged.
 *
 * Falls back to the other provider if the primary fails BEFORE any byte is sent.
 * Once streaming has started, errors propagate (we can't rewind).
 */
export async function streamLLM(opts: CallLLMOptions): Promise<ReadableStream<Uint8Array>> {
  const route = WORKFLOW_ROUTING[opts.workflow] ?? WORKFLOW_ROUTING.generic;
  const isNormanChat = opts.workflow === "norman-chat";
  const primary = isNormanChat ? "openai" : opts.force_provider ?? route.primary;
  const fallback: Provider = isNormanChat ? "openai" : route.fallback;

  const tryProvider = async (provider: Provider, attempt: number): Promise<ReadableStream<Uint8Array>> => {
    const start = Date.now();
    if (provider === "openai") {
      const stream = await openaiStream(opts, pickModel("openai", opts));
      log(opts.workflow, provider, attempt, "ok", Date.now() - start, "stream=open");
      return stream;
    }
    const stream = await claudeStreamAsOpenAI(opts, pickModel("claude", opts));
    log(opts.workflow, provider, attempt, "ok", Date.now() - start, "stream=open");
    return stream;
  };

  try {
    return await tryProvider(primary, 1);
  } catch (err: any) {
    if (opts.force_provider || primary === fallback || !isRetryable(err?.status)) {
      log(opts.workflow, primary, 1, "fail", 0, `status=${err?.status}`);
      throw err;
    }
    log(opts.workflow, primary, 1, "fallback", 0, `status=${err?.status}`);
    return await tryProvider(fallback, 2);
  }
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
  // GPT-5 family only supports default temperature (1).
  if (opts.temperature !== undefined && !model.startsWith("gpt-5")) body.temperature = opts.temperature;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(`OpenAI stream ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.body;
}

async function claudeStreamAsOpenAI(opts: CallLLMOptions, model: string): Promise<ReadableStream<Uint8Array>> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const { system, messages } = toAnthropicMessages(opts.messages);
  const body: any = {
    model,
    max_tokens: opts.max_tokens ?? 4096,
    messages,
    stream: true,
  };
  if (system) body.system = system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const tools = toAnthropicTools(opts.tools);
  if (tools) body.tools = tools;
  const tc = toAnthropicToolChoice(opts.tool_choice);
  if (tc) body.tool_choice = tc;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(`Anthropic stream ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }

  // Transform Anthropic SSE → OpenAI-shaped SSE
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Track active content blocks: index → { type, toolCallIndex?, toolId?, toolName?, argumentsBuffer? }
  const blocks = new Map<number, { type: "text" | "tool_use"; toolCallIndex?: number; toolId?: string; toolName?: string; argumentsBuffer?: string }>();
  let toolCallCounter = 0;

  function emit(delta: any): Uint8Array {
    const payload = { choices: [{ index: 0, delta, finish_reason: null }] };
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  }
  function emitFinish(reason: string): Uint8Array {
    const payload = { choices: [{ index: 0, delta: {}, finish_reason: reason }] };
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  }

  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          let evt: any;
          try { evt = JSON.parse(jsonStr); } catch { continue; }

          switch (evt.type) {
            case "content_block_start": {
              const block = evt.content_block;
              if (block.type === "text") {
                blocks.set(evt.index, { type: "text" });
              } else if (block.type === "tool_use") {
                if (!block.id || !block.name) {
                  blocks.set(evt.index, { type: "tool_use" });
                  break;
                }
                const tcIdx = toolCallCounter++;
                blocks.set(evt.index, { type: "tool_use", toolCallIndex: tcIdx, toolId: block.id, toolName: block.name, argumentsBuffer: "" });
                controller.enqueue(emit({
                  tool_calls: [{
                    index: tcIdx,
                    id: block.id,
                    type: "function",
                    function: { name: block.name, arguments: "" },
                  }],
                }));
              }
              break;
            }
            case "content_block_delta": {
              const b = blocks.get(evt.index);
              if (!b) break;
              const d = evt.delta;
              if (d.type === "text_delta" && b.type === "text") {
                controller.enqueue(emit({ content: d.text }));
              } else if (d.type === "input_json_delta" && b.type === "tool_use") {
                b.argumentsBuffer = `${b.argumentsBuffer ?? ""}${d.partial_json ?? ""}`;
                if (!b.toolName || typeof b.toolCallIndex !== "number") break;
                controller.enqueue(emit({
                  tool_calls: [{
                    index: b.toolCallIndex,
                    function: { arguments: d.partial_json ?? "" },
                  }],
                }));
              }
              break;
            }
            case "content_block_stop": {
              const b = blocks.get(evt.index);
              if (b?.type === "tool_use" && (!b.toolName || typeof b.toolCallIndex !== "number")) {
                blocks.delete(evt.index);
              }
              break;
            }
            case "message_delta": {
              const reason = evt.delta?.stop_reason;
              if (reason) {
                const finish = reason === "tool_use" ? "tool_calls"
                             : reason === "end_turn" ? "stop"
                             : reason === "max_tokens" ? "length"
                             : reason;
                controller.enqueue(emitFinish(finish));
              }
              break;
            }
            case "message_stop": {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            case "error": {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: evt.error })}\n\n`));
              break;
            }
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      try { reader.cancel(); } catch { /* ignore */ }
    },
  });
}
