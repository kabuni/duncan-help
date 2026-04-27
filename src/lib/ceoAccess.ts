/**
 * Access control for the Team Briefing.
 *
 * Two tiers:
 *  - VIEWERS: any authenticated user can read briefings (`canViewBriefing`).
 *  - GENERATORS: the CEO (Nimesh) OR any user with the 'admin' role can trigger generation.
 *    `canGenerateBriefing(email)` only checks the email allowlist; admin status is
 *    layered on at the call site (see `src/pages/CEOBriefing.tsx`) via `useIsAdmin`,
 *    and enforced server-side in `supabase/functions/ceo-briefing/index.ts` and via RLS.
 */

/** @deprecated legacy viewer allowlist — viewing is now open to all signed-in users. */
export const CEO_EMAILS = ["nimesh@kabuni.com", "palash@kabuni.com"] as const;

/** Only Nimesh can generate / regenerate briefings. */
export const CEO_GENERATOR_EMAILS = ["nimesh@kabuni.com"] as const;

/** @deprecated use CEO_EMAILS. Kept for backwards-compat with older imports. */
export const CEO_EMAIL = CEO_EMAILS[0];

/** True for the legacy CEO allowlist (Nimesh + Palash). Used by features other than the briefing. */
export const isCEO = (email: string | null | undefined): boolean =>
  CEO_EMAILS.includes(((email ?? "").toLowerCase()) as (typeof CEO_EMAILS)[number]);

/** Anyone signed in can view the Team Briefing. */
export const canViewBriefing = (email: string | null | undefined): boolean =>
  !!email;

/** Only the CEO can trigger briefing generation. */
export const canGenerateBriefing = (email: string | null | undefined): boolean =>
  CEO_GENERATOR_EMAILS.includes(((email ?? "").toLowerCase()) as (typeof CEO_GENERATOR_EMAILS)[number]);
