## Plan: Auto-schedule `process-rsvp-emails` every 5 minutes

### What to do
Create a Supabase migration that:
1. Enables `pg_cron` and `pg_net` extensions (idempotent).
2. Unschedules any prior job named `process-rsvp-emails-every-5min` (idempotent re-run safety).
3. Schedules a new cron job `process-rsvp-emails-every-5min` running `*/5 * * * *` that POSTs to `https://rfwvemsjwytxxhwowpqh.supabase.co/functions/v1/process-rsvp-emails` with the project anon key in the `apikey` and `Authorization` headers.

No code changes. The "Scan RSVPs" button in `KeyEventsDiary.tsx` stays as a manual override. Deduplication continues to rely on the existing `gmail_message_id` check inside the edge function — no schema change needed.

### Why this is safe
- The edge function already skips any Gmail message whose `gmail_message_id` exists in `event_rsvps`, so overlapping cron + manual runs cannot create duplicate RSVP rows.
- `verify_jwt = false` is already set for `process-rsvp-emails` in `supabase/config.toml`, so the cron HTTP call needs no user JWT.

### Where the schedule lives & how to change it
- **Created in:** the new migration file under `supabase/migrations/` (timestamped, e.g. `..._schedule_process_rsvp_emails.sql`).
- **Job name:** `process-rsvp-emails-every-5min` (visible in `cron.job`).
- **To change cadence:** write a new migration that calls `cron.unschedule('process-rsvp-emails-every-5min')` then `cron.schedule(...)` with the new expression. Common alternatives: `*/10 * * * *` (10 min), `*/15 * * * *` (15 min), `0 * * * *` (hourly).
- **To pause:** migration with `select cron.unschedule('process-rsvp-emails-every-5min');`.
- **To inspect runs:** `select * from cron.job_run_details where jobname = 'process-rsvp-emails-every-5min' order by start_time desc limit 20;`

### SQL to be applied
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('process-rsvp-emails-every-5min')
where exists (select 1 from cron.job where jobname = 'process-rsvp-emails-every-5min');

select cron.schedule(
  'process-rsvp-emails-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://rfwvemsjwytxxhwowpqh.supabase.co/functions/v1/process-rsvp-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<anon key>',
      'Authorization', 'Bearer <anon key>'
    ),
    body := jsonb_build_object('trigger', 'cron', 'at', now())
  );
  $$
);
```

### Out of scope (per request)
- No edge function code changes.
- No new dedupe key (still per `gmail_message_id`).
- No audit log table.
