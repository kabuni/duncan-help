# Mandatory Onboarding & Activation Flow

## 1. Audit Summary (current state)

**Auth lifecycle today**
- `Auth.tsx` → `supabase.auth.signUp` (email/password). `handle_new_user()` trigger creates `profiles` row with `approval_status = 'pending'`.
- `ProtectedRoute` only checks `session` + `profile.approval_status === 'approved'`. After approval → full app access.
- No onboarding state, no first-run wizard.

**Personalization (single source of truth — must be reused)**
- Lives entirely in `public.profiles`, edited via `SettingsProfile.tsx` + `useProfile()`:
  - `display_name`, `role_title`, `department`, `bio`
  - `norman_context` ← the actual "Duncan Personalisation" free-text prompt that feeds AI context
  - `avatar_url`
  - `preferences` (jsonb, currently mostly unused — good place for onboarding state)
- Used by Duncan's prompt engine (`bio` + `norman_context` injected into system prompt — see `mem://features/profile-personalization`).

**Integrations to gate on (Gmail + Google Calendar)**
- Per-user OAuth, already complete:
  - `gmail_tokens` table + `gmail-auth` / `gmail-callback` edge functions, hook `useGmailIntegration`.
  - `google_calendar_tokens` table + `google-calendar-auth` / `google-calendar-callback`, hook `useGoogleCalendar`.
- Both already have "Connect" buttons in `/integrations`. We reuse these hooks verbatim — no rebuild.

## 2. State Model (minimal, no new table)

Add two columns to `public.profiles`:
- `onboarding_completed_at timestamptz null`
- `onboarding_step text not null default 'welcome'`  (`welcome | integrations | personalization | done`)

Rationale: keeps onboarding co-located with approval/profile, avoids a parallel table, no jsonb gymnastics. Existing personalization fields stay exactly where they are.

A user is **fully active** when:
```
approval_status = 'approved' AND onboarding_completed_at IS NOT NULL
```

## 3. Route & Gating Flow

```text
unauth ─────────────► /auth
pending approval ───► <Pending Approval screen> (existing)
approved + !onboarded ─► /onboarding (forced, sidebar/chat/etc. blocked)
approved + onboarded ──► full app
```

Extend `ProtectedRoute`:
1. No session → `/auth`
2. `approval_status !== 'approved'` → existing pending screen
3. `onboarding_completed_at == null` → `<Navigate to="/onboarding">` (whitelist `/onboarding` itself + `/auth`)
4. Otherwise render children.

The `/onboarding` route renders a fullscreen flow (no `AppLayout`, no Sidebar) so the rest of the platform is genuinely inaccessible.

## 4. Onboarding UX (modern AI-workspace style)

Single-page, 3 steps with progress dots. Linear/Cursor feel — large type, generous whitespace, one decision per screen, framer-motion transitions.

**Step 1 — Welcome / Activation**
- Duncan avatar, "Let's get you set up" headline, 3 short bullets (Connect → Personalize → Go).
- Single "Get started" CTA. No forms.

**Step 2 — Integrations (mandatory)**
- Two cards: Gmail, Google Calendar. Each shows live status from `useGmailIntegration` / `useGoogleCalendar`.
- "Connect" buttons trigger the existing OAuth flows. After redirect back, the step auto-detects connection and shows a green check.
- "Continue" disabled until both connected. Optional "Why?" tooltip explaining what Duncan does with them.

**Step 3 — Duncan Personalization (reuses existing system)**
- Renders the EXACT same fields backed by `useProfile().updateProfile`:
  - Display name (prefilled)
  - Role / Department (prefilled from signup)
  - About you (`bio`)
  - Duncan Personalisation (`norman_context`) — same textarea, same field, same storage
- A small `<PersonalizationForm>` component is extracted from `SettingsProfile.tsx` and reused by both Settings and Onboarding. Zero duplicate state.

**Step 4 — Activation**
- "You're all set" screen. Sets `onboarding_completed_at = now()`, `onboarding_step = 'done'`. Redirects to `/`.

After each step, persist `onboarding_step` so refresh/return resumes in place.

## 5. Backend / Security

**Phase 1 (this PR — frontend gate, parity with current approval model):**
- `ProtectedRoute` enforces onboarding. Same trust level as today's approval gate.

**Phase 2 (recommended follow-up, NOT in this PR unless requested):**
- Add SECURITY DEFINER `public.is_active_user(uid)` returning `approved AND onboarded`.
- Tighten RLS on sensitive tables to use `is_active_user(auth.uid())` instead of bare `auth.uid()`.
- Edge functions add an early `is_active_user` check after `getUser()`.
- Risk of doing it now: broad RLS rewrite touches every domain table → high regression surface. Better as a dedicated hardening pass once the UX is shipped and stable.

## 6. Schema Migration

```sql
ALTER TABLE public.profiles
  ADD COLUMN onboarding_completed_at timestamptz,
  ADD COLUMN onboarding_step text NOT NULL DEFAULT 'welcome';

-- Existing approved users grandfathered in (don't force them through onboarding):
UPDATE public.profiles
   SET onboarding_completed_at = now(), onboarding_step = 'done'
 WHERE approval_status = 'approved';
```
RLS: existing self-update policy already covers writes. No new policies needed.

## 7. Files Affected

**New**
- `src/pages/Onboarding.tsx` — flow shell + step orchestration
- `src/components/onboarding/StepWelcome.tsx`
- `src/components/onboarding/StepIntegrations.tsx`
- `src/components/onboarding/StepPersonalization.tsx`
- `src/components/onboarding/StepComplete.tsx`
- `src/components/profile/PersonalizationForm.tsx` — extracted from SettingsProfile, reused by both

**Modified**
- `src/App.tsx` — add `/onboarding` route
- `src/components/ProtectedRoute.tsx` — onboarding gate
- `src/hooks/useProfile.ts` — surface `onboarding_completed_at`, `onboarding_step`
- `src/components/settings/SettingsProfile.tsx` — swap inline form for `<PersonalizationForm>`

**Migration**
- Adds two columns + grandfathers existing approved users.

## 8. Risks & Notes

- Grandfathering current approved users avoids locking the team out on deploy.
- OAuth callbacks return to `/integrations` today; onboarding detects connection state on mount via existing hooks (no callback changes needed).
- `norman_context` remains the single AI personalization field — onboarding writes to it directly, so Settings and onboarding are perfectly in sync.
- Backend enforcement intentionally deferred to keep this change scoped and safe.

## 9. Rollout

1. Apply migration (grandfathers existing users).
2. Ship frontend gate + onboarding flow.
3. Monitor: any new signup goes through full flow; existing users see no change.
4. Follow-up PR: `is_active_user()` + RLS/edge hardening (Phase 2).

Awaiting approval before implementation.
