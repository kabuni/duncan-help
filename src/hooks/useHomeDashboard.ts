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

export type ProjectsStats = {
  active: number;
  filesIndexed: number;
  updatedToday: number;
};

const FIVE_MIN = 5 * 60 * 1000;

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
        supabase.from("job_roles").select("id", { count: "exact", head: true }).eq("status", "open"),
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
        supabase
          .from("workstream_card_assignees")
          .select("card_id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("acceptance_status", "accepted"),
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
