## Goal

Switch the recruitment workflow's edge-function calls to prefer FastAPI (`VITE_API_BASE_URL`) when configured, with Supabase Edge Functions as fallback. Keep all database, storage, and PostgREST traffic on Supabase. Make zero UI/design changes.

## Current State (from exploration)

- A `withFastApi` utility already exists at `src/lib/fastApiClient.ts`.
- Most recruitment edge-function calls in `src/pages/Recruitment.tsx` and `src/components/recruitment/JobRolesManager.tsx` are already wrapped in `withFastApi(...)` with the exact FastAPI paths the user specified (`/recruitment/generate-jd`, `/recruitment/score-values`, `/recruitment/score-competencies`, `/recruitment/parse-jd`, `/hireflix/create-position`, `/hireflix/position/{id}`, `/hireflix/send-invite`, `/gmail/auth`).
- **Two call sites are NOT wrapped yet** and call Supabase directly:
  - `Recruitment.tsx:147` — `hireflix-sync-interviews`
  - `Recruitment.tsx:244` — `fetch-gmail-cvs` (this one has special 409/`already_running` lock handling)
- The current routing rule in `withFastApi` is gated by `VITE_USE_FASTAPI === "true" && hasExternalApiBase`. The user wants the trigger to be **`VITE_API_BASE_URL` set alone** — no separate `VITE_USE_FASTAPI` flag required.

## Changes

### 1. `src/lib/fastApiClient.ts` — flip the routing rule

Make FastAPI the primary path whenever `VITE_API_BASE_URL` is set:

- Remove the `VITE_USE_FASTAPI` requirement. The new rule:
  - `hasExternalApiBase === true` → FastAPI primary, Supabase fallback (try FastAPI first; on any error, log a warning and call Supabase).
  - `hasExternalApiBase === false` → Supabase only (current behaviour preserved exactly; no shadow call, no FastAPI traffic).
- Keep `USE_FASTAPI` exported for backwards compatibility, but redefine it as `hasExternalApiBase`.
- Keep the existing `fastApi()` function and the `withFastApi()` signature unchanged so all existing call sites keep working.

This single change automatically updates every recruitment call already using `withFastApi` (generate-jd ×2, parse-jd-competencies, create-hireflix-position, delete-hireflix-position, score-cv-values, score-cv-competencies, hireflix-send-invite, gmail-auth) — they will now route to FastAPI first when `VITE_API_BASE_URL` is set.

### 2. `src/pages/Recruitment.tsx` — wrap the two remaining calls

**a) `hireflix-sync-interviews` (line ~147)**

Wrap with `withFastApi`, preserving fire-and-forget semantics:

```ts
await withFastApi(
  async () => {
    const res = await supabase.functions.invoke("hireflix-sync-interviews");
    if (res.error) throw res.error;
    return res.data;
  },
  () => fastApi("POST", "/hireflix/sync-interviews", {}),
);
```

**b) `fetch-gmail-cvs` (line ~244)** — special case

This one inspects `res.error.context` for an HTTP 409 / `already_running` lock response. To preserve that behaviour without changing UI logic, we keep the existing Supabase invocation path inline, and only add a FastAPI-first attempt before it:

```ts
let res: any;
if (hasExternalApiBase) {
  try {
    const data = await fastApi<any>("POST", "/recruitment/fetch-gmail-cvs", { role_id: selectedRoleId });
    res = { data, error: null };
  } catch (err: any) {
    // FastAPI 409 → already running
    if (String(err?.message || "").includes("→ 409")) {
      toast.message("Fetch already running for this role");
      return;
    }
    console.warn("[FastAPI fetch-gmail-cvs failed, falling back to Supabase]", err);
    res = await supabase.functions.invoke("fetch-gmail-cvs", { body: { role_id: selectedRoleId } });
  }
} else {
  res = await supabase.functions.invoke("fetch-gmail-cvs", { body: { role_id: selectedRoleId } });
}
// …existing 409 / has_more handling untouched below…
```

Import `hasExternalApiBase` and `fastApi` at the top of `Recruitment.tsx` (already imported in this file's neighbourhood; verify and add if missing).

### 3. Out of scope (explicitly unchanged)

- All `supabase.from(...)` queries (candidates, job_roles, sync_logs, hireflix_retry_queue, profiles, etc.).
- All `supabase.storage.*` calls (CV signed URLs, JD upload).
- All PostgREST REST calls.
- All UI, toast copy, loading states, query keys, and component structure.
- `JobRolesManager.tsx` — no source edits needed; its calls already route correctly via `withFastApi` once step 1 lands.

## Behaviour after the change

| `VITE_API_BASE_URL` | Edge-function calls | DB / Storage / REST |
|---|---|---|
| **set** | FastAPI first → Supabase fallback on error | Supabase (unchanged) |
| **empty** | Supabase only (no FastAPI traffic) | Supabase (unchanged) |

## Verification checklist

- With `VITE_API_BASE_URL` empty: recruitment behaves exactly as today (no network calls to any external host; no console warnings about FastAPI).
- With `VITE_API_BASE_URL` set: each of the 10 listed endpoints hits FastAPI first; on a 4xx/5xx/network failure, Supabase Edge Function is invoked transparently and the UI shows the same result.
- `fetch-gmail-cvs` 409 lock flow still surfaces the "Fetch already running for this role" toast, regardless of which backend served the response.
- No changes to candidate list, role list, scoring badges, JD generation UI, or Hireflix buttons.