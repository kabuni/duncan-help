# Hire → Onboarding Automation

When a candidate flips to **Hired**, Duncan spins up a complete onboarding workstream: card + tasks, calendar invites, provisioning checklist, welcome email, and a draft 30/90-day plan — all linked back to the original recruitment record.

## 1. Trigger

Two entry points, both call the same edge function:

- **Status change** on candidate → new status `hired` (or label `Hired` on the recruitment card). Fires automation immediately using existing hire metadata.
- **"Mark as Hired" button** on the candidate detail page. Opens a small dialog to collect/confirm:
  - Start date (required)
  - Hiring manager (required, profile picker)
  - Employment type (full-time / part-time / contractor)
  - Work location (remote / office / hybrid)
  - Preferred name (defaults to parsed CV name)
  
  On submit, sets status to `hired` and triggers the same flow.

A guard prevents double-firing (idempotency key on `candidate_id`).

## 2. Data model changes

New columns / tables:

- `candidates`: add `hired_at`, `start_date`, `hiring_manager_id`, `employment_type`, `work_location`, `onboarding_card_id`
- `onboarding_runs` (new): one row per hire, tracks automation status (`pending` / `provisioning` / `scheduled` / `completed` / `failed`) and stores the generated 30/90 plan JSON
- `role_access_defaults` (new): per department/role → list of tools/accounts to provision (Duncan seeds sensible defaults; editable in Settings later)

## 3. What gets created (atomic, in one edge function)

### a. Workstream card
- Title: `Onboard: [Full Name]`
- Owner: Hiring Manager (primary), Ops user (co-owner — configurable in Settings, defaults to first admin)
- Project tag: `Onboarding`
- Status: amber, priority high
- Description: links back to candidate + job role
- Attachments: CV + JD (copied from candidate record)

### b. Task groups (sort_order preserved)

```text
Pre-boarding (before start date)
  - Send welcome email + offer letter        [auto-done on trigger]
  - Provisioning: <generated from Role Access Matrix>
  - Order equipment / confirm remote setup
  - Add to Slack channels: #general, #<department>

Day 1
  - 90-min orientation session               [calendar event auto-created]
  - Manager intro 1:1                        [calendar event auto-created]
  - Policy acknowledgements (handbook, security, IP)
  - Device & security check

Week 1
  - Leadership intros (15-30 min each)       [drafted as tasks + calendar events]
  - Shadow 2 team meetings
  - Complete required training modules

Weeks 2-4
  - Weekly manager 1:1 (recurring, 30 min)   [calendar series auto-created]
  - First deliverable scoped with manager

Day 30 review
  - Manager review against 30-day plan
  - New hire self-reflection form

Day 90 review
  - Manager review against 90-day plan
  - Confirm probation outcome
```

### c. Role Access Matrix (defaults)
Duncan generates a default access list per department using GPT-4o (seeded from JD + role title). Examples:
- Engineering → GitHub, Azure DevOps, Linear, AWS read, Notion
- Sales → HubSpot, Gong, Slack sales channels
- Ops → Basecamp, Google Drive shared folders, finance read

Each becomes a provisioning task assigned to the relevant admin/owner. Admins can edit the matrix in Settings → Onboarding.

### d. Calendar events (auto-created on manager's Google Calendar)
- Day-1 orientation (90 min, start date 9:30am local)
- Manager 1:1 weekly recurring × 4
- Leadership intros: one event per leader within first 10 working days (uses `check_team_availability` to find slots; falls back to a draft task if no slot found)
- All include new hire's email + relevant attendees; description links to onboarding card

### e. Welcome email (auto-sent immediately)
- Template: `onboarding-welcome` (new React Email template in `_shared/transactional-email-templates/`)
- Sent from company sender to new hire (CC: hiring manager)
- Includes: start date, manager name, Day-1 logistics, offer letter as signed Drive link (pulled from candidate record if attached)
- Optional Slack DM to hiring manager: "Onboarding started for [Name] — card here"

### f. 30/90-day plan (draft)
- GPT-4o reads JD + role responsibilities, drafts a structured plan:
  - Days 1-30: learning goals, intros, first small deliverable
  - Days 31-90: ownership areas, KPIs, stakeholder map
- Stored as note attached to onboarding card; assigned to manager for review (task: "Review and finalize 30/90-day plan with [Name]")

## 4. Ongoing tracking (reuses existing infra)

- Overdue task notifications (existing `workstream-overdue-notifications` cron) covers nudging owners
- Daily briefing surfaces onboarding cards with overdue items or red status
- Onboarding card auto-completes when all tasks done and Day-90 review marked complete

## 5. UI surface area

- **Candidate detail page**: "Mark as Hired" button (admins + hiring managers only)
- **Workstreams board**: filter chip "Onboarding" 
- **Settings → Onboarding**: edit Role Access Matrix defaults, set Ops co-owner, toggle Slack DM
- **Recruitment card**: visible link to generated onboarding card once created

## Technical notes

- New edge function `trigger-onboarding` (verify_jwt=false, internal auth via getUser)
- Uses existing `workstream_cards`, `workstream_tasks`, `workstream_card_assignees` tables
- Calendar: uses existing `google_calendar_tokens` for the hiring manager; if missing, queues a notification asking them to connect
- Email: scaffold transactional email infra if not already present, then add `onboarding-welcome` template
- All writes wrapped in try/catch with `onboarding_runs.status` updated per stage so partial failures are visible and re-runnable
- Idempotency: edge function checks `candidates.onboarding_card_id` first — if set, returns existing card instead of duplicating

## Out of scope (for this iteration)

- HRIS integration (e.g. BambooHR sync)
- Background check / right-to-work verification
- Payroll setup
- Editable Role Access Matrix UI (ships with seeded defaults; edit later)
