CREATE TABLE IF NOT EXISTS public.effort_savings_config (
  action_key text PRIMARY KEY,
  minutes numeric NOT NULL CHECK (minutes >= 0),
  source text NOT NULL DEFAULT 'chat_tool',
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.effort_savings_config TO authenticated;
GRANT ALL ON public.effort_savings_config TO service_role;
ALTER TABLE public.effort_savings_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read effort config"
ON public.effort_savings_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage effort config"
ON public.effort_savings_config FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.savings_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action_key text NOT NULL,
  source text NOT NULL DEFAULT 'chat_tool',
  minutes_saved numeric NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_savings_events_user_time ON public.savings_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_savings_events_time ON public.savings_events (occurred_at DESC);

GRANT SELECT, INSERT ON public.savings_events TO authenticated;
GRANT ALL ON public.savings_events TO service_role;
ALTER TABLE public.savings_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own savings events"
ON public.savings_events FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own savings events"
ON public.savings_events FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.log_savings_event(_action_key text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _minutes numeric;
  _source text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  SELECT c.minutes, c.source INTO _minutes, _source
  FROM public.effort_savings_config c
  WHERE c.action_key = _action_key;

  IF _minutes IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.savings_events (user_id, action_key, source, minutes_saved, metadata)
  VALUES (auth.uid(), _action_key, COALESCE(_source, 'ui_action'), _minutes, COALESCE(_metadata, '{}'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_savings_event(text, jsonb) TO authenticated;

INSERT INTO public.effort_savings_config (action_key, minutes, source, label) VALUES
('create_calendar_event',3,'chat_tool','Create calendar event'),
('update_calendar_event',2,'chat_tool','Update calendar event'),
('delete_calendar_event',1,'chat_tool','Delete calendar event'),
('reschedule_event',3,'chat_tool','Reschedule event'),
('update_planner_event_meta',2,'chat_tool','Update planner event meta'),
('list_calendar_events',2,'chat_tool','List calendar events'),
('list_planner_events',2,'chat_tool','List planner events'),
('check_team_availability',8,'chat_tool','Check team availability'),
('send_gmail_email',8,'chat_tool','Send email'),
('draft_gmail_email',12,'chat_tool','Draft email'),
('draft_gmail_reply',6,'chat_tool','Draft reply'),
('list_gmail_emails',4,'chat_tool','List emails'),
('read_gmail_email',3,'chat_tool','Read email'),
('read_gmail_thread',6,'chat_tool','Read thread'),
('search_gmail',10,'chat_tool','Search email'),
('create_workstream_card',10,'chat_tool','Create workstream card'),
('update_workstream_card',6,'chat_tool','Update workstream card'),
('add_tasks_to_card',8,'chat_tool','Add tasks to card'),
('list_workstream_cards',4,'chat_tool','List workstream cards'),
('get_workstream_card',3,'chat_tool','Get workstream card'),
('get_workstream_analytics',20,'chat_tool','Workstream analytics'),
('list_my_project_tasks',5,'chat_tool','List project tasks'),
('analyze_meetings',45,'chat_tool','Analyze meetings'),
('list_meetings',3,'chat_tool','List meetings'),
('list_meetings_by_source',4,'chat_tool','List meetings by source'),
('get_meeting',5,'chat_tool','Get meeting'),
('search_meeting_transcripts',20,'chat_tool','Search transcripts'),
('get_meeting_action_items_with_context',30,'chat_tool','Meeting action items'),
('get_action_items_for_range',20,'chat_tool','Action items for range'),
('create_bug_report',20,'chat_tool','Create bug report'),
('create_feature_request',20,'chat_tool','Create feature request'),
('send_slack_message',3,'chat_tool','Send Slack message'),
('list_slack_channels',2,'chat_tool','List Slack channels'),
('read_slack_channel_messages',8,'chat_tool','Read Slack messages'),
('query_azure_work_items',15,'chat_tool','Query work items'),
('get_azure_work_item',8,'chat_tool','Get work item'),
('search_synced_work_items',12,'chat_tool','Search work items'),
('list_azure_devops_projects',5,'chat_tool','List DevOps projects'),
('list_azure_repos',5,'chat_tool','List repos'),
('list_pull_requests',12,'chat_tool','List pull requests'),
('get_pr_reviews',20,'chat_tool','PR reviews'),
('get_recent_commits',15,'chat_tool','Recent commits'),
('get_repos_team_summary',45,'chat_tool','Repos team summary'),
('get_operational_summary',60,'chat_tool','Operational summary'),
('ui.workstream.create_card',7,'ui_action','Create workstream card (UI)'),
('ui.workstream.update_card',4.5,'ui_action','Update card (UI)'),
('ui.workstream.find_task',4.8,'ui_action','Find task (UI)'),
('ui.workstream.assign_users',3.5,'ui_action','Assign users (UI)'),
('ui.workstream.add_subtask',4,'ui_action','Add subtask (UI)'),
('ui.workstream.add_comment',1.7,'ui_action','Add comment (UI)'),
('ui.workstream.upload_attachment',2.7,'ui_action','Upload attachment (UI)'),
('ui.workstream.present_view',27,'ui_action','Workstreams present view'),
('ui.workstream.overdue_followup',20,'ui_action','Automatic overdue follow-up'),
('ui.planner.create_event',4.5,'ui_action','Create event (UI)'),
('ui.planner.reschedule_event',9,'ui_action','Reschedule event (UI)'),
('ui.planner.check_availability',14.8,'ui_action','Check team availability (UI)'),
('ui.planner.add_rsvp',3.5,'ui_action','Add RSVP (UI)'),
('ui.planner.calendar_sync',5,'ui_action','Calendar sync'),
('ui.plan90.update_deliverable',9,'ui_action','Update deliverable'),
('ui.plan90.add_update',5.5,'ui_action','Add progress update'),
('ui.plan90.find_latest_update',11.8,'ui_action','Find latest update'),
('ui.plan90.presentation',55,'ui_action','Executive presentation')
ON CONFLICT (action_key) DO UPDATE SET minutes = EXCLUDED.minutes, source = EXCLUDED.source, label = EXCLUDED.label, updated_at = now();

CREATE OR REPLACE FUNCTION public.get_token_leaderboard()
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, total_tokens bigint, request_count bigint, minutes_saved bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH tokens AS (
    SELECT tu.user_id,
           SUM(tu.total_tokens)::bigint AS total_tokens,
           SUM(tu.request_count)::bigint AS request_count
    FROM public.token_usage tu
    GROUP BY tu.user_id
  ),
  saved AS (
    SELECT se.user_id, SUM(se.minutes_saved) AS minutes
    FROM public.savings_events se
    GROUP BY se.user_id
  ),
  ids AS (
    SELECT user_id FROM tokens
    UNION
    SELECT user_id FROM saved
  )
  SELECT
    i.user_id,
    COALESCE(p.display_name, 'Unknown') AS display_name,
    p.avatar_url,
    COALESCE(t.total_tokens, 0)::bigint AS total_tokens,
    COALESCE(t.request_count, 0)::bigint AS request_count,
    COALESCE(ROUND(s.minutes), 0)::bigint AS minutes_saved
  FROM ids i
  LEFT JOIN tokens t ON t.user_id = i.user_id
  LEFT JOIN saved s ON s.user_id = i.user_id
  LEFT JOIN public.profiles p ON p.user_id = i.user_id
  ORDER BY COALESCE(t.total_tokens, 0) DESC;
$function$;