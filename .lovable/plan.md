Replace the placeholder welcome email body in `poll-workspace-new-users/index.ts` with the approved Kabuni copy.

## Changes

**File:** `supabase/functions/poll-workspace-new-users/index.ts` — `buildHtml(firstName)`

New email content (rendered as branded HTML, with `[First Name]` swapped for the user's Workspace given name; falls back to "Hi there," if missing):

> Hi {First Name},
>
> Welcome to Kabuni!
>
> We're building the future of sports technology — connecting fans, clubs, and athletes through innovative digital experiences. We're a fast-moving, ambitious team and we're genuinely thrilled to have you with us.
>
> To get you up and running, here are a few things to complete as part of your onboarding:
>
> **1. Duncan, our AI office assistant**
> Your go-to for workplace queries, documents, and day-to-day support.
> 👉 [duncan.help](https://duncan.help)
>
> **2. Slack, our team communication hub**
> This is where the magic happens — join your relevant channels and say hello!
> 👉 [kabuni.slack.com](https://kabuni.slack.com)
>
> We move fast, collaborate openly, and back each other up.
>
> We're so excited to have you on board and can't wait to see what you bring to the team. Don't hesitate to reach out if you need anything as you settle in.
>
> — The Kabuni team

Subject stays **"Welcome to Kabuni"**. Sender stays **duncan@kabuni.com**.

## Styling

Keeps the existing Kabuni-branded HTML shell (Inter font, teal pill badge, white background, muted body text). Numbered onboarding steps rendered as bold headings with description + link button styling consistent with the current template. No structural changes elsewhere — polling, scheduling, dedupe log, and UI remain as-is.

## Deploy

Redeploy the `poll-workspace-new-users` edge function after the edit. You can verify by clicking **Run now** in Settings → Workspace Welcome Emails (no new users → 0 sent, but confirms the function runs cleanly).

## Optional follow-up (not in this change)

If you'd like to test against your own inbox without provisioning a new Workspace user, I can add a small "Send test to me" button that fires the new template to the logged-in admin's email. Say the word and I'll bundle it in.