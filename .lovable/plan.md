# Weekly Executive Analytics — Revised Plan

**Scope change:** No new dashboard page. Extend the existing **Operations → Website Analytics** tab (`src/pages/Operations.tsx`, `section === "analytics"`) and add a **Weekly Executive Email Digest**. The prior Daily GA Email initiative is retired as part of this work.

---

## 1. Audit findings

### Existing dashboard (`Operations.tsx` → "Website Analytics" tab)
- Powered by `useGoogleAnalytics()` → edge function `google-analytics-api` action `dashboard`.
- 30-day window only. Shows: Active users, Sessions, Page views, Engagement rate, Top countries, Top pages, Top cities, Device mix, Demographics, Sources (channels, yesterday-only).
- Has a free-form "Ask Duncan about analytics" input.
- No filters, no WoW/MoM, no landing pages, no 404s, no registrations.

### GA integration (`google-analytics-api/index.ts`)
- Shared canonical GA4 token, scope `analytics.readonly` — **sufficient for every requirement below**.
- Actions today: `checkConnection`, `dashboard`, `home_summary`, `pages_analytics`, `askQuestion`, `disconnect`.
- Already fetches `sessionDefaultChannelGroup`, `deviceCategory`, `country`, `city`, `pageTitle`. Missing: multi-date-range comparisons, `landingPage`, 404 detection, filterable dimensions.

### Registration data source — **confirmed live**
Two public forms write directly into Supabase:
- `src/pages/RegisterSchool.tsx` → `public.school_registrations` (17 rows, last write 2026‑06‑07).
- `nda_submissions` also exists (74 rows) but is legal-flow, not a "website registration."
- No other public sign-up forms write to `profiles` or `candidates` from the marketing site.

**Decision:** the "registration" metric for this dashboard = rows in `public.school_registrations` grouped by `created_at`. Confirmed against the live website form.

### Overlap with existing Daily GA report
`daily-ga-report` edge function + `ga_daily_report_log` + `pg_cron` daily job were built in the previous iteration. Per revised requirements they are **out of scope**: pause the `pg_cron` job and leave the code path dormant (removed in a follow-up). Recipients list moves to a weekly key.

---

## 2. Metrics — where each comes from

| Requirement | Source | Status |
|---|---|---|
| Users, Sessions, Views, Engagement | GA4 `dashboard`/`weekly_report` | ✅ live, extend to 7d window |
| WoW / MoM deltas | GA4 multi-`dateRanges` in one `runReport` | ❌ new query, no storage needed |
| Acquisition (9 channels) | GA4 `sessionDefaultChannelGroup` over 7d | ⚠️ query exists yesterday-only; widen to 7d |
| Top Pages | GA4 `pagePath` + views | ⚠️ currently by `pageTitle`; switch to path |
| Top Landing Pages | GA4 `landingPage` dimension | ❌ new query |
| 404s | GA4 `pagePath` filtered by `pageTitle` regex `(?i)(404\|not found)` | ❌ new query, heuristic |
| Countries / Cities | GA4 | ✅ live |
| Device Mix | GA4 `deviceCategory` | ✅ live |
| Registrations (daily + weekly + WoW) | `public.school_registrations` grouped by `created_at::date` | ❌ new SQL rollup |

All satisfied by existing `analytics.readonly` scope. No historical snapshot table required for Phase 1 — GA4 answers multi-period queries in a single call.

---

## 3. Backend changes

### `google-analytics-api/index.ts` — add one action, `weekly_report`
Accepts optional filters and returns everything the dashboard tab + email need in one payload:

```ts
type WeeklyFilters = {
  country?: string; device?: "desktop"|"mobile"|"tablet";
  channel?: string; source?: string; medium?: string;
  dateRange?: { start: string; end: string }; // defaults to this ISO week
};
```

Internally issues one batched fan-out (respecting the existing `runLimited(2, ...)` GA concurrency guard):
- Summary metrics with **three `dateRanges`**: `current`, `prior_week`, `prior_month` → yields WoW + MoM in a single call.
- Channels breakdown (7d) mapped onto the fixed 9-channel list; missing channels return 0.
- Top pages by `pagePath` (limit 8) and Top landing pages by `landingPage` (limit 8).
- 404 report: `pagePath` where `pageTitle` matches the regex, limit 10.
- Countries, cities, devices (7d).
- Daily time-series (`date` dimension) for the sparkline.

Filters translate to GA `dimensionFilter` clauses; no filter runs on the cached default payload.

Payload contract is versioned (`schema_version: 1`, additive) so new metrics ship without dashboard rewrites.

### Registrations rollup — SQL function (no new table)
```sql
create or replace function public.get_registrations_rollup(_start date, _end date)
returns table(day date, count bigint) language sql stable security definer set search_path=public as $$
  select date_trunc('day', created_at)::date as day, count(*)::bigint
  from public.school_registrations
  where created_at >= _start and created_at < _end + 1
  group by 1 order by 1;
$$;
grant execute on function public.get_registrations_rollup(date,date) to authenticated, service_role;
```
The edge function calls this via `supabase.rpc` and merges the result into the payload (`registrations: { daily, weekly, priorWeek, deltaPct }`). Conversion rate = `weekly / GA sessions` — computed server-side so the dashboard and email agree.

### No new snapshot table
Deltas come from GA4 multi-range queries. If historical trend > GA's default lookback is later requested, revisit with a `ga_weekly_snapshots` JSONB table — designed additive so it can be added without breaking clients.

### Weekly email — new edge function `weekly-ga-report`
- Invokes `google-analytics-api?action=weekly_report` (default filters).
- Renders executive-brief HTML (KPI table with WoW/MoM, 9-channel acquisition table, top pages, top landing pages, 404 count + URLs, geo, devices, registrations).
- Sends from `duncan@kabuni.com` via Gmail to recipients configured in `app_settings.weekly_ga_report_recipients`.
- Idempotency: reuse `ga_daily_report_log` with a new `cadence` column (`weekly` | `daily`) and unique key on `(cadence, period_start)`.
- **Pause** the existing daily `pg_cron` job; add a new job **Mondays 07:00 UTC** invoking `weekly-ga-report` for the prior ISO week.

Single source of truth: dashboard tab and email both hit `weekly_report`. No duplicate GA queries.

---

## 4. Dashboard changes (existing Operations tab)

Extend `Operations.tsx` `TabsContent value="analytics"` in place. Layout stays inside the current tab — no new route, no new sidebar entry.

```text
[Filters row] Date Range · Country · Device · Channel · Source/Medium · [Reset]

[KPI row]  Users | Sessions | Views | Engagement | Avg Engagement Time
           each tile: value · WoW % · MoM % · 7-day sparkline

[Acquisition]     9-channel table (sessions, users, WoW)
[Registrations]   weekly total · daily line · conversion rate

[Top Pages]  [Top Landing Pages]  [404s: count + top URLs]

[Countries]  [Cities]  [Device Mix]

[Ask Duncan] — kept as-is
```

New hook method `useGoogleAnalytics().weekly(filters)` wraps `weekly_report`; the existing `dashboard` query stays for the "Ask Duncan" answer context. React Query caches per `filters` key so switching filters is instant on repeat.

Filters map 1:1 to `WeeklyFilters` on the edge function. If a filter combination returns no rows the tiles render "—" instead of empty charts.

---

## 5. Schema changes

- `alter table public.ga_daily_report_log add column cadence text not null default 'daily'` and swap the unique constraint to `(cadence, period_start)`.
- New RPC `public.get_registrations_rollup(date, date)` (above).
- No new tables. `app_settings` gains a new row key `weekly_ga_report_recipients` (data change, not schema).

---

## 6. Weekly email format

Subject: `Duncan · Weekly Web Report — Mon DD to Sun DD`

1. Headline KPIs (metric · this week · WoW % · MoM %)
2. Acquisition — 9-channel table
3. Registrations — weekly total, daily average, conversion rate, WoW %
4. Content — Top 5 pages, Top 5 landing pages, 404 count + top 5 URLs
5. Geo — top 5 countries, top 5 cities
6. Devices — Desktop / Mobile / Tablet
7. Footer: link to `Operations → Website Analytics`

Executive-brief style, no prose commentary.

---

## 7. Effort estimate

| Workstream | Size |
|---|---|
| `google-analytics-api` — add `weekly_report` + filters + landing pages + 404 heuristic | **M** (~1 day) |
| Registrations RPC + payload merge | **S** (~2 h) |
| `weekly-ga-report` edge function + HTML template | **M** (~1 day) — reuse daily-report renderer |
| `pg_cron` swap: pause daily, add weekly | **S** (~30 min) |
| Migration for `ga_daily_report_log.cadence` | **S** (~30 min) |
| Operations dashboard tab: filters, KPI tiles, WoW/MoM, landing pages, 404s, registrations | **M–L** (~1.5 days) |
| QA + idempotency + docs | **S** (~half day) |

**Total ≈ 4 engineering days.**

---

## 8. Gaps / dependencies

- **404 detection** relies on `pageTitle` regex — misses hard 404s that never render the SPA route. Fine for v1; a proper fix (GA4 `page_view` event with `page_not_found: true`) is a follow-up.
- **Affiliates** channel only appears when GA4 has an affiliates channel-group override configured. Otherwise the row renders `0 — not configured in GA4`.
- **Conversion-rate denominator** fixed to GA4 sessions for the same window (documented in the email footer).
- Registration form scope: only `school_registrations` is a live website registration source today. If other forms are added later, they add a new branch inside `get_registrations_rollup` (no schema change).

---

## 9. Rollout sequence

1. Migration: `ga_daily_report_log.cadence` + registrations RPC.
2. Extend `google-analytics-api` with `weekly_report` + filters.
3. Ship dashboard tab enhancements behind existing "Website Analytics" tab.
4. Ship `weekly-ga-report` edge function + template.
5. Pause daily `pg_cron`; add Monday 07:00 UTC weekly job.
6. Two-week soak; remove the daily code path.
