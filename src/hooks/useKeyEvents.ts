import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface KeyEvent {
  id: string;
  google_event_id: string;
  title: string;
  event_name: string | null;
  category: string | null;
  raw_description: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  html_link: string | null;
  organizer_email: string | null;
  status: string | null;

  owner: string | null;
  objective: string | null;
  success_metric: string | null;
  decision_needed: string | null;
  linked_docs: string[];
  risks: string | null;
  next_action: string | null;

  missing_fields: string[];
  is_complete: boolean;
  risk_level: "green" | "amber" | "red";
  risk_reason: string | null;
  /** UUIDs of workstream_cards (column repurposed from goals). */
  linked_goal_ids: string[];

  deleted_in_google: boolean;
  synced_at: string;
}

export interface WorkstreamCard {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  project_tag: string | null;
}

export interface DuncanCalendarStatus {
  connected: boolean;
  google_account_email: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  last_updated: string | null;
}

export interface SyncLog {
  id: string;
  started_at: string;
  finished_at: string | null;
  events_seen: number;
  events_upserted: number;
  events_flagged: number;
  status: string;
  error: string | null;
}

export function useKeyEvents() {
  const [events, setEvents] = useState<KeyEvent[]>([]);
  const [cards, setCards] = useState<WorkstreamCard[]>([]);
  const [status, setStatus] = useState<DuncanCalendarStatus | null>(null);
  const [lastSync, setLastSync] = useState<SyncLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: ev }, { data: wc }, { data: st }, { data: log }] = await Promise.all([
        supabase
          .from("key_events" as any)
          .select("*")
          .eq("deleted_in_google", false)
          .order("start_at", { ascending: true }),
        supabase
          .from("workstream_cards" as any)
          .select("id, title, status, priority, due_date, project_tag")
          .is("archived_at", null)
          .order("updated_at", { ascending: false }),
        supabase.rpc("get_duncan_calendar_status" as any),
        supabase
          .from("key_event_sync_log" as any)
          .select("*")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setEvents((ev as any[]) || []);
      setCards((wc as any[]) || []);
      const stRow = Array.isArray(st) ? (st[0] as any) : (st as any);
      setStatus(stRow ? (stRow as DuncanCalendarStatus) : { connected: false, google_account_email: null, calendar_id: null, calendar_name: null, last_updated: null });
      setLastSync((log as any) || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connect = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("duncan-calendar-auth");
    if (error) throw error;
    const url = (data as any)?.url;
    if (url) window.location.href = url;
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("duncan-calendar-sync");
      if (error) throw error;
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  return { events, cards, status, lastSync, loading, syncing, refresh, connect, sync };
}
