import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Rag, Trend } from "@/hooks/useMarketingHealth";

/**
 * AI Efficiency data layer.
 *
 * SINGLE SOURCE OF TRUTH: public.get_ai_efficiency_metrics() — an admin-only
 * security-definer RPC that aggregates, live, from:
 *   • public.savings_events        -> hours saved, automated actions, top tools
 *   • public.effort_savings_config -> human labels + minute weightings
 *   • public.token_usage           -> tokens, request counts, active users
 *
 * Nothing is stored, duplicated or hand-maintained. Any KPI without a live
 * source is returned as `awaiting: true` and rendered as "Awaiting integration"
 * — never as a plausible-looking hardcoded number.
 *
 * Metrics still awaiting a live source:
 *   • Tool success / failure rate  -> needs a tool-execution log table
 *   • AI cost (daily / monthly / per user / per request) -> needs provider billing feed
 *   • Cost vs value / ROI multiple -> derived from cost, so also blocked
 */

export type { Rag, Trend };

/* ---------------- targets (editable config, not data) ---------------- */
export const EFFICIENCY_TARGETS = {
  /** Hours saved across the workspace in a rolling 30 days. */
  monthlyHoursSaved: 200,
  /** Share of workspace members active with Duncan in a rolling 30 days. */
  monthlyAdoptionRate: 0.6,
  amberFactor: 0.75,
};

/** Weightings for the Efficiency Health Score, per the executive spec. */
export const EFFICIENCY_WEIGHTS = {
  hoursSaved: 0.3,
  adoption: 0.2,
  toolSuccess: 0.2,
  costEfficiency: 0.15,
  roi: 0.15,
};

export interface Metric {
  label: string;
  value: string;
  sub?: string;
  trend?: Trend;
  deltaPct?: number | null;
  rag?: Rag;
  awaiting?: boolean;
}

export interface ScoreComponent {
  label: string;
  weight: number;
  points: number | null;
  rag: Rag | null;
  detail: string;
  awaiting: boolean;
}

interface RawMetrics {
  generated_at: string;
  hours_saved: { today: number; week: number; prev_week: number; month: number; prev_month: number; all_time: number };
  actions: { total: number; month: number };
  top_actions: { action_key: string; label: string; uses: number; minutes: number }[];
  tokens: { today: number; week: number; prev_week: number; month: number; prev_month: number; all_time: number };
  requests: { today: number; week: number; prev_week: number; month: number; prev_month: number; all_time: number };
  active_users: { dau: number; wau: number; mau: number; prev_mau: number };
  workspace_users: number;
}

/* ------------------------------ helpers ------------------------------ */

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

export function fmtCompact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function fmtHours(minutes: number) {
  const h = minutes / 60;
  if (h >= 100) return `${Math.round(h)} h`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(minutes)} min`;
}

function deltaPct(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function trendFor(delta: number | null): Trend | undefined {
  if (delta === null) return undefined;
  if (delta > 2) return "up";
  if (delta < -2) return "down";
  return "flat";
}

function ragFor(value: number, target: number): Rag {
  if (value >= target) return "on_track";
  if (value >= target * EFFICIENCY_TARGETS.amberFactor) return "attention";
  return "critical";
}

const POINTS: Record<Rag, number> = { on_track: 100, attention: 65, critical: 30 };

export function scoreRag(score: number): Rag {
  if (score >= 85) return "on_track";
  if (score >= 60) return "attention";
  return "critical";
}

/* -------------------------------- hook -------------------------------- */

export interface AiEfficiency {
  loading: boolean;
  error: string | null;
  /** True when the viewer lacks admin rights for workspace-wide aggregates. */
  restricted: boolean;
  generatedAt: string | null;
  score: number | null;
  scoreRag: Rag | null;
  scoreFormula: string;
  components: ScoreComponent[];
  summary: string;
  hoursSaved: Metric[];
  tokens: Metric[];
  requests: Metric[];
  activeUsers: Metric[];
  cost: Metric[];
  costVsValue: Metric[];
  toolSuccess: Metric[];
  topTools: { label: string; uses: number; minutes: number }[];
  headline: Metric[];
}

const AWAITING = (label: string, sub?: string): Metric => ({
  label,
  value: "Awaiting integration",
  sub,
  awaiting: true,
});

export function useAiEfficiency(): AiEfficiency {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-efficiency-metrics"],
    queryFn: async (): Promise<RawMetrics> => {
      const { data, error } = await (supabase as any).rpc("get_ai_efficiency_metrics");
      if (error) throw error;
      return data as RawMetrics;
    },
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const errMsg = error ? (error as any)?.message ?? "Unable to load metrics" : null;
  const restricted = !!errMsg && /not_authorised|permission/i.test(errMsg);

  const empty: AiEfficiency = {
    loading: isLoading,
    error: errMsg,
    restricted,
    generatedAt: null,
    score: null,
    scoreRag: null,
    scoreFormula: "",
    components: [],
    summary: "",
    hoursSaved: [],
    tokens: [],
    requests: [],
    activeUsers: [],
    cost: [],
    costVsValue: [],
    toolSuccess: [],
    topTools: [],
    headline: [],
  };

  if (!data) return empty;

  const hs = data.hours_saved;
  const tk = data.tokens;
  const rq = data.requests;
  const au = data.active_users;

  const monthHours = num(hs.month) / 60;
  const monthDelta = deltaPct(num(hs.month), num(hs.prev_month));
  const weekDelta = deltaPct(num(hs.week), num(hs.prev_week));

  const hoursSaved: Metric[] = [
    { label: "Today", value: fmtHours(num(hs.today)) },
    { label: "This week", value: fmtHours(num(hs.week)), trend: trendFor(weekDelta), deltaPct: weekDelta, sub: "vs previous 7 days" },
    {
      label: "This month",
      value: fmtHours(num(hs.month)),
      trend: trendFor(monthDelta),
      deltaPct: monthDelta,
      sub: `Target ${EFFICIENCY_TARGETS.monthlyHoursSaved} h · vs previous 30 days`,
      rag: ragFor(monthHours, EFFICIENCY_TARGETS.monthlyHoursSaved),
    },
    { label: "All time", value: fmtHours(num(hs.all_time)) },
  ];

  const tokenDelta = deltaPct(num(tk.month), num(tk.prev_month));
  const tokens: Metric[] = [
    { label: "Daily", value: fmtCompact(num(tk.today)) },
    { label: "Weekly", value: fmtCompact(num(tk.week)) },
    { label: "Monthly", value: fmtCompact(num(tk.month)), trend: trendFor(tokenDelta), deltaPct: tokenDelta },
  ];

  const reqDelta = deltaPct(num(rq.month), num(rq.prev_month));
  const requests: Metric[] = [
    { label: "Today", value: fmtCompact(num(rq.today)) },
    { label: "This week", value: fmtCompact(num(rq.week)) },
    { label: "This month", value: fmtCompact(num(rq.month)), trend: trendFor(reqDelta), deltaPct: reqDelta },
  ];

  const workspaceUsers = num(data.workspace_users) || 0;
  const adoptionRate = workspaceUsers ? num(au.mau) / workspaceUsers : 0;
  const mauDelta = deltaPct(num(au.mau), num(au.prev_mau));

  const activeUsers: Metric[] = [
    { label: "Daily active", value: `${num(au.dau)}` },
    { label: "Weekly active", value: `${num(au.wau)}` },
    {
      label: "Monthly active",
      value: `${num(au.mau)}`,
      sub: workspaceUsers ? `${Math.round(adoptionRate * 100)}% of ${workspaceUsers} members · target ${Math.round(EFFICIENCY_TARGETS.monthlyAdoptionRate * 100)}%` : undefined,
      trend: trendFor(mauDelta),
      deltaPct: mauDelta,
      rag: ragFor(adoptionRate, EFFICIENCY_TARGETS.monthlyAdoptionRate),
    },
  ];

  const monthRequests = num(rq.month);
  const avgMinutesPerRequest = monthRequests ? num(hs.month) / monthRequests : 0;

  const headline: Metric[] = [
    {
      label: "Avg time saved per request",
      value: monthRequests ? `${avgMinutesPerRequest.toFixed(1)} min` : "—",
      sub: "Rolling 30 days · minutes saved ÷ AI requests",
    },
    {
      label: "Manual tasks automated",
      value: fmtCompact(num(data.actions.total)),
      sub: `${fmtCompact(num(data.actions.month))} in the last 30 days`,
    },
  ];

  const cost: Metric[] = [
    AWAITING("Cost — daily", "Needs provider billing feed"),
    AWAITING("Cost — monthly", "Needs provider billing feed"),
    AWAITING("Cost per user", "Derived from billing feed"),
    AWAITING("Cost per request", "Derived from billing feed"),
  ];

  const costVsValue: Metric[] = [
    AWAITING("Total AI spend", "Needs provider billing feed"),
    {
      label: "Estimated value created",
      value: `${fmtHours(num(hs.all_time))} of effort`,
      sub: "From savings_events × effort_savings_config",
    },
    AWAITING("ROI multiple", "Requires spend to divide value by"),
  ];

  const toolSuccess: Metric[] = [
    AWAITING("Successful executions", "Needs a tool-execution log"),
    AWAITING("Failed executions", "Needs a tool-execution log"),
    AWAITING("Trend", "Needs a tool-execution log"),
  ];

  const topTools = (data.top_actions || []).map((t) => ({
    label: t.label || t.action_key,
    uses: num(t.uses),
    minutes: num(t.minutes),
  }));

  /* -------------------- Efficiency Health Score -------------------- */
  const hoursRag = ragFor(monthHours, EFFICIENCY_TARGETS.monthlyHoursSaved);
  const adoptionRagValue = ragFor(adoptionRate, EFFICIENCY_TARGETS.monthlyAdoptionRate);

  const components: ScoreComponent[] = [
    {
      label: "Hours saved",
      weight: EFFICIENCY_WEIGHTS.hoursSaved,
      points: POINTS[hoursRag],
      rag: hoursRag,
      detail: `${monthHours.toFixed(1)} h vs ${EFFICIENCY_TARGETS.monthlyHoursSaved} h target (30 days)`,
      awaiting: false,
    },
    {
      label: "AI adoption",
      weight: EFFICIENCY_WEIGHTS.adoption,
      points: POINTS[adoptionRagValue],
      rag: adoptionRagValue,
      detail: `${Math.round(adoptionRate * 100)}% of members active vs ${Math.round(EFFICIENCY_TARGETS.monthlyAdoptionRate * 100)}% target`,
      awaiting: false,
    },
    { label: "Tool success rate", weight: EFFICIENCY_WEIGHTS.toolSuccess, points: null, rag: null, detail: "Awaiting tool-execution log", awaiting: true },
    { label: "Cost efficiency", weight: EFFICIENCY_WEIGHTS.costEfficiency, points: null, rag: null, detail: "Awaiting provider billing feed", awaiting: true },
    { label: "ROI / business value", weight: EFFICIENCY_WEIGHTS.roi, points: null, rag: null, detail: "Awaiting provider billing feed", awaiting: true },
  ];

  const scored = components.filter((c) => !c.awaiting && c.points !== null);
  const availableWeight = scored.reduce((s, c) => s + c.weight, 0);
  const score = availableWeight
    ? Math.round(scored.reduce((s, c) => s + (c.points as number) * c.weight, 0) / availableWeight)
    : null;

  const scoreFormula = availableWeight
    ? `(${scored.map((c) => `${c.points} × ${Math.round(c.weight * 100)}%`).join(" + ")}) ÷ ${Math.round(availableWeight * 100)}% available weight = ${score}`
    : "No live inputs available yet.";

  const summary = (() => {
    const parts: string[] = [];
    parts.push(
      `Duncan saved ${fmtHours(num(hs.month))} across the last 30 days (${monthDelta === null ? "no prior baseline" : `${monthDelta > 0 ? "+" : ""}${monthDelta.toFixed(0)}% vs previous period`}).`
    );
    parts.push(`${num(au.mau)} of ${workspaceUsers || "—"} members were active, running ${fmtCompact(monthRequests)} AI requests.`);
    if (hoursRag === "critical") parts.push("Hours saved is materially below target — adoption of automated actions needs a push.");
    else if (adoptionRagValue !== "on_track") parts.push("Adoption is the main constraint on further efficiency gains.");
    else parts.push("Both live inputs are on or above target.");
    parts.push("Cost, ROI and tool success rate are excluded until their live sources are connected.");
    return parts.join(" ");
  })();

  return {
    loading: false,
    error: null,
    restricted: false,
    generatedAt: data.generated_at,
    score,
    scoreRag: score === null ? null : scoreRag(score),
    scoreFormula,
    components,
    summary,
    hoursSaved,
    tokens,
    requests,
    activeUsers,
    cost,
    costVsValue,
    toolSuccess,
    topTools,
    headline,
  };
}
