
# Email Intelligence v2 — Plan

Today the Gmail flow drafts every reply and waits for you in Gmail. This upgrade turns Duncan into a graded assistant: trusted senders get auto-sent replies, uncertain ones get pushed to you for one-tap approval, and meeting requests are handled EA-style with country/timezone awareness.

## 1. Trust engine (whitelist → auto-send)

Extend `gmail_writing_profiles` and add a per-sender trust ledger:

- New table `gmail_sender_trust(user_id, sender_email, sends_approved, sends_edited, sends_rejected, confidence 0–100, auto_send_enabled bool, last_updated)`.
- Every time you send/edit/discard a Duncan draft, `gmail-api` logs the outcome and recomputes confidence (approved without edit ⇒ +, heavy edit ⇒ −, reject ⇒ hard reset).
- `SettingsGmail` gets a **Trusted senders** panel: whitelist entries become auto-send-eligible once confidence ≥ threshold (default 80, configurable) AND ≥ 5 approved sends. Manual override to force-trust or force-review.
- `gmail-auto-draft` splits into two paths:
  - **Auto-send path** (whitelist + trusted + high AI self-confidence + no risky content flags: money, legal, unsubscribe, external new domain): sends immediately, labels `Duncan/Auto-Sent`, notifies via bell + Slack with "Undo (15 min)" that recalls via Gmail draft-of-record + reply-all warning.
  - **Draft path** (current behaviour) for everything else.
- Safety guards: never auto-send to first-time senders, replies with attachments, threads > N participants, or when AI self-reports low confidence.

## 2. Continuous tone learning

`gmail-train-style` runs once. We move to incremental learning:

- New cron `gmail-learn-incremental` (hourly): pulls newly-Sent messages since `last_trained_at`, cleans + redacts, appends to a rolling sample store (`gmail_style_samples` capped at ~500 latest).
- Weekly re-summarise: regenerate `style_summary`, `tone_metrics`, `common_phrases` from the rolling window so drift is captured (holidays, new hires, tone shifts).
- Per-recipient style: cluster samples by recipient domain/thread so tone to investors ≠ tone to team; drafts pick the closest cluster.
- Feedback signal: when you edit a draft, diff old→new is stored as a "correction sample" weighted higher in the next retrain.

## 3. "When in doubt" approval loop

Today drafts sit silently in Gmail. New flow:

- When Duncan drafts a reply and confidence is medium (below auto-send but above spam), it posts an **approval card** via the existing `notifications` + Slack DM rails:
  - Subject, sender, 3-line summary of the incoming email, the proposed reply, and buttons: **Send as-is**, **Edit & send**, **Discard**.
  - "Edit & send" opens a lightweight edit sheet (Gmail composer already exists at `/gmail`); on submit it sends via `gmail-api` and logs an "edited" outcome to the trust ledger.
- Reuses the notification bell + Slack pattern already used for approvals, so no new UI system.

## 4. EA-style meeting triage (all users, not just Nimesh)

Current `ea-poll-inbox` is hardcoded to Nimesh and Duncan's central inbox. Generalise:

- Per-user EA mode toggle in `SettingsGmail` ("Let Duncan act as my EA"). When on, `ea-poll-inbox` iterates all opted-in users using their own `gmail_tokens` + `google_calendar_tokens`.
- Meeting-intent classifier already exists — extend to:
  1. If sender didn't state purpose → auto-reply asking for purpose + rough duration, mark `awaiting_purpose`.
  2. Once purpose is known → score urgency (P1–P4) using existing prompt, plus new signals: sender seniority (HubSpot lookup), keywords, and whether user's calendar has a hard block.
  3. Propose slots against **user's** calendar honouring their working hours + timezone.
- **Country/timezone awareness**: new `profiles.current_timezone` + `current_country` (auto-detected from most recent calendar event location / last login IP, overridable). Slot proposals, reply salutations, and "urgent" thresholds respect local working hours. When you're travelling, Duncan says "Nimesh is in Dubai this week (GMT+4)" in the reply.
- Approval still required to send the invite (existing `ea-confirm-meeting`), but low-friction: appears in the same bell/Slack card as §3.

## 5. Phasing

- **Phase 1 (small):** Continuous learning cron + per-recipient clustering + edit-diff feedback.
- **Phase 2 (medium):** Trust ledger, Settings UI, in-app/Slack approval card with Send/Edit/Discard.
- **Phase 3 (medium):** Auto-send path with guards + 15-min undo.
- **Phase 4 (medium):** Generalise EA meeting flow per user + timezone/country awareness.

## Open questions

1. **Confidence threshold defaults**: 80/100 and 5 approved sends before auto-send unlocks — OK, or stricter?
2. **Undo window**: 15 minutes acceptable, or shorter?
3. **Country detection**: derive from calendar/last login automatically, or require you to set it in Settings?
4. **Approval channel**: Slack DM + in-app bell (both), or only one?
