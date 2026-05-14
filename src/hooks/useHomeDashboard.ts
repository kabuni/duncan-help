import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type GAHomeSummary = {
  connected: boolean;
  play?: {
    hoursLast30: number;
    hoursPrev30: number;
    deltaPct: number | null;
    countriesToday: number;
    sparkline: { date: string; hours: number }[];
  };
  website?: {
    activeUsers7d: number;
    sessions7d: number;
    pageViews7d: number;
    topPage: string | null;
  };
};

export type HiresStats = {
  openRoles: number;
  totalCandidates: number;
  interviewsThisWeek: number;
};

export type WorkstreamsStats = {
  active: number;
  red: number;
  overdue: number;
  onTrackPct: number;
  myOpen: number;
};

const FIVE_MIN = 5 * 60 * 1000;

export type SocialStats = {
  fetchedAt: string | null;
  sourceFilename: string | null;
  accounts: Array<{
    account: string;
    followers: number | null;
    posts: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    engagement_rate: number | null;
    delta_followers: number | null;
    delta_likes: number | null;
    week_label: string | null;
  }>;
};

export function useSocialStats() {
  return useQuery<SocialStats>({
    queryKey: ["home-dashboard", "social"],
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_stats_snapshots")
        .select("account,followers,posts,likes,comments,shares,engagement_rate,prev_followers,prev_likes,week_label,fetched_at,source_filename")
        .order("fetched_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const latestBatchTs = rows[0]?.fetched_at ?? null;
      const filename = rows[0]?.source_filename ?? null;
      const seen = new Set<string>();
      const accounts = rows
        .filter((r) => r.fetched_at === latestBatchTs)
        .filter((r) => {
          const k = (r.account || "").toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((r) => ({
          account: r.account,
          followers: r.followers,
          posts: r.posts,
          likes: r.likes,
          comments: r.comments,
          shares: r.shares,
          engagement_rate: r.engagement_rate,
          delta_followers: r.followers != null && r.prev_followers != null ? Number(r.followers) - Number(r.prev_followers) : null,
          delta_likes: r.likes != null && r.prev_likes != null ? Number(r.likes) - Number(r.prev_likes) : null,
          week_label: r.week_label,
        }));
      return { fetchedAt: latestBatchTs, sourceFilename: filename, accounts };
    },
  });
}

export type ProjectsStats = {
  active: number;
  filesIndexed: number;
  updatedToday: number;
};



export function useGAHomeSummary() {
  return useQuery<GAHomeSummary>({
    queryKey: ["home-dashboard", "ga"],
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("google-analytics-api", {
        body: { action: "home_summary" },
      });
      if (error) throw error;
      return data as GAHomeSummary;
    },
  });
}

export function useHiresStats() {
  return useQuery<HiresStats>({
    queryKey: ["home-dashboard", "hires"],
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const [rolesRes, candidatesRes, interviewsRes] = await Promise.all([
        supabase.from("job_roles").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("candidates").select("id", { count: "exact", head: true }),
        supabase
          .from("candidates")
          .select("id", { count: "exact", head: true })
          .gte("hireflix_invited_at", weekStart.toISOString()),
      ]);

      return {
        openRoles: rolesRes.count ?? 0,
        totalCandidates: candidatesRes.count ?? 0,
        interviewsThisWeek: interviewsRes.count ?? 0,
      };
    },
  });
}

export function useWorkstreamsStats() {
  const { user } = useAuth();
  return useQuery<WorkstreamsStats>({
    queryKey: ["home-dashboard", "workstreams", user?.id],
    enabled: !!user,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const [allRes, redRes, overdueRes, mineRes] = await Promise.all([
        supabase.from("workstream_cards").select("id, status", { count: "exact" }).neq("status", "done"),
        supabase
          .from("workstream_cards")
          .select("id", { count: "exact", head: true })
          .eq("status", "red")
          .neq("status", "done"),
        supabase
          .from("workstream_cards")
          .select("id", { count: "exact", head: true })
          .lt("due_date", nowIso)
          .neq("status", "done"),
        (supabase as any)
          .from("workstream_card_assignees")
          .select("card_id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("assignment_status", "accepted"),
      ]);

      const all = (allRes.data ?? []) as Array<{ id: string; status: string }>;
      const total = all.length;
      const green = all.filter((c) => c.status === "green").length;
      const onTrackPct = total > 0 ? Math.round((green / total) * 100) : 0;

      return {
        active: total,
        red: redRes.count ?? 0,
        overdue: overdueRes.count ?? 0,
        onTrackPct,
        myOpen: mineRes.count ?? 0,
      };
    },
  });
}

export function useProjectsStats() {
  return useQuery<ProjectsStats>({
    queryKey: ["home-dashboard", "projects"],
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [projRes, filesRes, updatedRes] = await Promise.all([
        supabase.from("projects").select("id", { count: "exact", head: true }),
        supabase.from("project_files").select("id", { count: "exact", head: true }),
        supabase
          .from("project_files")
          .select("id", { count: "exact", head: true })
          .gte("created_at", dayAgo),
      ]);

      return {
        active: projRes.count ?? 0,
        filesIndexed: filesRes.count ?? 0,
        updatedToday: updatedRes.count ?? 0,
      };
    },
  });
}

export type RsvpStats = {
  total: number;
  confirmed: number;
  maybe: number;
  declined: number;
  missingInfo: number;
};

const RSVP_FIELDS = ["first_name", "last_name", "phone", "email", "organisation_type", "organisation_name", "state"] as const;

export function useRsvpStats(eventId: string) {
  const [data, setData] = useState<RsvpStats | null>(null);
  const [loading, setLoading] = useState(true);

  const compute = useCallback((rows: any[]): RsvpStats => {
    const total = rows.length;
    const confirmed = rows.filter((r) => r.status === "yes").length;
    const maybe = rows.filter((r) => r.status === "maybe").length;
    const declined = rows.filter((r) => r.status === "no").length;
    const missingInfo = rows.filter((r) =>
      RSVP_FIELDS.some((f) => !r[f] || String(r[f]).trim().length === 0)
    ).length;
    return { total, confirmed, maybe, declined, missingInfo };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      const { data: rows } = await supabase
        .from("event_rsvps" as any)
        .select("*")
        .eq("event_id", eventId);
      if (mounted) {
        setData(compute((rows as any[]) || []));
        setLoading(false);
      }
    };
    load();

    const channel = supabase
      .channel(`home-rsvps-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_rsvps", filter: `event_id=eq.${eventId}` },
        async () => {
          const { data: rows } = await supabase
            .from("event_rsvps" as any)
            .select("*")
            .eq("event_id", eventId);
          if (mounted) setData(compute((rows as any[]) || []));
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [eventId, compute]);

  return { data, loading };
}
