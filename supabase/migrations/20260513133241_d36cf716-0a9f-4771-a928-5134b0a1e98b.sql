-- Schedule process-rsvp-emails to run every 5 minutes
-- Job name: process-rsvp-emails-every-5min
-- To change cadence: write a new migration that calls cron.unschedule('process-rsvp-emails-every-5min') then cron.schedule(...) with a new expression
-- To pause: cron.unschedule('process-rsvp-emails-every-5min')
-- To inspect: select * from cron.job_run_details where jobname = 'process-rsvp-emails-every-5min' order by start_time desc limit 20;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-rsvp-emails-every-5min') then
    perform cron.unschedule('process-rsvp-emails-every-5min');
  end if;
end $$;

select cron.schedule(
  'process-rsvp-emails-every-5min',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://rfwvemsjwytxxhwowpqh.supabase.co/functions/v1/process-rsvp-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmd3ZlbXNqd3l0eHhod293cHFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NTc2NTcsImV4cCI6MjA4NjAzMzY1N30.in8xz4qXQCqM8rs0PXXrmMt3epmt8nNFUHVD3kWyYn4',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmd3ZlbXNqd3l0eHhod293cHFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NTc2NTcsImV4cCI6MjA4NjAzMzY1N30.in8xz4qXQCqM8rs0PXXrmMt3epmt8nNFUHVD3kWyYn4'
    ),
    body := jsonb_build_object('trigger', 'cron', 'at', now())
  );
  $cron$
);