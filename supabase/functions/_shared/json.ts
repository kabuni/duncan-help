// Safe JSON parsing for LLM tool-call arguments.
// Returns null on unrecoverable input — callers must check.

function repair(raw: string): string {
  let input = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  const objectStart = input.indexOf("{");
  const arrayStart = input.indexOf("[");
  const starts = [objectStart, arrayStart].filter((i) => i >= 0);
  if (starts.length) input = input.slice(Math.min(...starts));

  let out = "";
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of input) {
    if (inString) {
      out += ch;
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") {
      while (closers.length && closers[closers.length - 1] !== ch) out += closers.pop();
      if (closers[closers.length - 1] === ch) closers.pop();
    }
    out += ch;
  }
  if (inString) out += '"';
  out = out.replace(/,\s*([}\]])/g, "$1");
  while (closers.length) out += closers.pop();
  return out.trim();
}

export function safeParseToolArguments<T = any>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as T;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed) as T; } catch { /* fall through */ }
  try { return JSON.parse(repair(trimmed)) as T; } catch { return null; }
}
