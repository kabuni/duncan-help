import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Operational health data layer.
 *
 * SINGLE SOURCE OF TRUTH: public.get_operational_metrics() — an admin-only
 * security-definer RPC that aggregates, live, from:
 *   • public.sync_logs        -> integration job runs + failures (30d)
 *   • public.briefing_runs    -> AI job runs, failures and average runtime (30d)
 *   • public.kb_documents / documents / project_files -> documents stored
 *   • public.company_integrations + user_integrations  -> connected integrations
 *   • public.issues           -> reported issues raised in the last 30 days
 *
 * Nothing is hardcoded. Any value the RPC cannot resolve renders as "—".
 */

export interface OperationalMetricsRaw {
  generated_at: string;
  job_runs: number;
  failed_jobs: number;
  success_rate: number | null;
  avg_run_ms: number | null;
  documents_stored: number;
  integrations_live: number;
  open_issues: number;
}

export interface OperationalStat {
  label: string;
  value: string;
}

function fmtNum(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}

function fmtDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function useOperationalHealth() {
  const query = useQuery({
    queryKey: ["operational-metrics"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async (): Promise<OperationalMetricsRaw | null> => {
      const { data, error } = await supabase.rpc("get_operational_metrics");
      if (error) throw error;
      return (data as unknown as OperationalMetricsRaw) ?? null;
    },
  });

  const d = query.data;

  const stats: OperationalStat[] = [
    { label: "Job success (30d)", value: d?.success_rate == null ? "—" : `${d.success_rate}%` },
    { label: "Avg AI run time", value: fmtDuration(d?.avg_run_ms) },
    { label: "Failed jobs (30d)", value: fmtNum(d?.failed_jobs) },
    { label: "Job runs (30d)", value: fmtNum(d?.job_runs) },
    { label: "Documents stored", value: fmtNum(d?.documents_stored) },
    { label: "Integrations live", value: fmtNum(d?.integrations_live) },
    { label: "Issues raised (30d)", value: fmtNum(d?.open_issues) },
  ];

  return {
    stats,
    generatedAt: d?.generated_at ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
