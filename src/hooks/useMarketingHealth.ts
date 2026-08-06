import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

/* ------------------------------------------------------------------
   Marketing Health — reusable data layer.

   All calculations (rates, trends, RAG) live here, NOT in the UI.
   The UI only renders what this hook returns.

   PRODUCTION DATA SOURCES (wire these in place of PLACEHOLDER_RAW):
     • registrations   -> Duncan table `public.school_registrations`
                          (count by created_at buckets: today / 7d / 30d,
                           plus the equal-length previous period)
     • sessions        -> GA4 `sessions` metric via the existing
                          `google-analytics-api` edge function
                          (action: "weekly_report" / custom date ranges)
     • trafficSources  -> GA4 `sessionDefaultChannelGroup` dimension
                          x `sessions` metric
     • ctaViews        -> GA4 custom event `cta_view`   (eventCount)
     • ctaClicks       -> GA4 custom event `cta_click`  (eventCount)

   Conversion rate and CTR are derived — never store them.
------------------------------------------------------------------- */

export type Rag = "on_track" | "attention" | "critical";
export type Trend = "up" | "down" | "flat";

/** Raw counters, exactly the shape a GA4 + Duncan aggregation should return. */
export interface MarketingRaw {
  /** Interest Registration form submissions (Duncan DB). */
  registrations: { today: number; week: number; month: number };
  registrationsPrev: { today: number; week: number; month: number };
  /** GA4 sessions. */
  sessions: { today: number; week: number; month: number };
  sessionsPrev: { today: number; week: number; month: number };
  /** GA4 channel group -> sessions (last 30 days). */
  trafficSources: Record<TrafficChannel, number>;
  /** GA4 custom events (last 30 days). */
  cta: { views: number; clicks: number };
  ctaPrev: { views: number; clicks: number };
  /** ISO timestamp of the aggregation run. */
  generatedAt: string;
  /** False while running on placeholder data. */
  live: boolean;
}

export type TrafficChannel =
  | "Organic Search"
  | "Direct"
  | "Paid Search"
  | "Social"
  | "Referral"
  | "Email";

export const TRAFFIC_CHANNELS: TrafficChannel[] = [
  "Organic Search",
  "Direct",
  "Paid Search",
  "Social",
  "Referral",
  "Email",
];

/* --------------------------- targets / RAG --------------------------- */

/** green = at/above target, amber = within `amberBand` below, red = worse. */
export interface Target {
  target: number;
  amberBand: number;
}

export const MARKETING_TARGETS = {
  /** Monthly interest registrations. */
  registrationsMonthly: { target: 250, amberBand: 60 } as Target,
  /** Visit-to-submission conversion, %. */
  conversionRate: { target: 2.5, amberBand: 0.8 } as Target,
  /** Monthly website sessions. */
  sessionsMonthly: { target: 90000, amberBand: 15000 } as Target,
  /** CTA click-through rate, %. */
  ctaCtr: { target: 6, amberBand: 1.5 } as Target,
};

/** Higher-is-better RAG evaluation against a target with an amber band. */
export function ragFor(value: number, { target, amberBand }: Target): Rag {
  if (value >= target) return "on_track";
  if (value >= target - amberBand) return "attention";
  return "critical";
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export function trendFor(delta: number | null, deadband = 1): Trend {
  if (delta === null) return "flat";
  if (delta > deadband) return "up";
  if (delta < -deadband) return "down";
  return "flat";
}

export function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

/* ---------------------------- placeholder ---------------------------- */

const PLACEHOLDER_RAW: MarketingRaw = {
  registrations: { today: 9, week: 54, month: 214 },
  registrationsPrev: { today: 7, week: 48, month: 187 },
  sessions: { today: 3120, week: 21480, month: 84620 },
  sessionsPrev: { today: 2960, week: 19870, month: 78140 },
  trafficSources: {
    "Organic Search": 34210,
    Direct: 19870,
    "Paid Search": 12440,
    Social: 9860,
    Referral: 5320,
    Email: 2920,
  },
  cta: { views: 61200, clicks: 3486 },
  ctaPrev: { views: 57400, clicks: 3010 },
  generatedAt: new Date().toISOString(),
  live: false,
};

/* ----------------------------- derived ------------------------------ */

export interface KpiPeriod {
  label: string;
  value: number;
  formatted: string;
  delta: number | null;
  trend: Trend;
}

export interface MarketingHealth {
  live: boolean;
  generatedAt: string;
  registrations: {
    total: number;
    periods: KpiPeriod[];
    rag: Rag;
  };
  conversion: {
    value: number;
    formatted: string;
    delta: number | null;
    trend: Trend;
    rag: Rag;
  };
  sessions: {
    periods: KpiPeriod[];
    rag: Rag;
  };
  trafficSources: Array<{ channel: TrafficChannel; sessions: number; share: number }>;
  ctaCtr: {
    value: number;
    formatted: string;
    clicks: number;
    views: number;
    delta: number | null;
    trend: Trend;
    rag: Rag;
  };
  /** Roll-up used as the Marketing Health score. */
  score: {
    value: number;
    rag: Rag;
    /** Per-KPI contributions to the roll-up (explainability only — no logic change). */
    breakdown: ScoreContribution[];
    /** e.g. "(100 + 65 + 30 + 65) / 4 = 65" */
    formula: string;
    /** Auto-generated one-line executive summary. */
    summary: string;
  };
}

export interface ScoreContribution {
  key: "registrations" | "conversion" | "sessions" | "ctaCtr";
  label: string;
  rag: Rag;
  points: number;
  /** Current value, formatted. */
  value: string;
  /** Target, formatted. */
  target: string;
}

const nf = new Intl.NumberFormat();
const fmtInt = (n: number) => nf.format(Math.round(n));
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

function period(label: string, value: number, prev: number): KpiPeriod {
  const delta = pctChange(value, prev);
  return { label, value, formatted: fmtInt(value), delta, trend: trendFor(delta) };
}

const RAG_POINTS: Record<Rag, number> = { on_track: 100, attention: 65, critical: 30 };

const listOf = (items: string[]) =>
  items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** Plain-English narration of the score — derived from the same RAGs, changes nothing. */
function buildSummary(breakdown: ScoreContribution[], overall: Rag): string {
  const green = breakdown.filter((b) => b.rag === "on_track").map((b) => b.label.toLowerCase());
  const amber = breakdown.filter((b) => b.rag === "attention").map((b) => b.label.toLowerCase());
  const red = breakdown.filter((b) => b.rag === "critical").map((b) => b.label.toLowerCase());

  if (!amber.length && !red.length) return "All marketing KPIs are at or above target — the funnel is performing on plan.";

  const strong = green.length ? `${listOf(green)} ${green.length > 1 ? "are" : "is"} on target` : null;
  const drag = [
    red.length ? `significantly below-target ${listOf(red)}` : null,
    amber.length ? `slightly below-target ${listOf(amber)}` : null,
  ].filter(Boolean) as string[];

  const head = strong ? `${strong.charAt(0).toUpperCase()}${strong.slice(1)}, but the` : "The";
  const tail = overall === "critical" ? "score is being pulled down by" : "overall score is reduced by";
  return `${head} ${tail} ${listOf(drag)}.`;
}



export function computeMarketingHealth(raw: MarketingRaw): MarketingHealth {
  const registrationsRag = ragFor(raw.registrations.month, MARKETING_TARGETS.registrationsMonthly);

  const conversionValue = rate(raw.registrations.month, raw.sessions.month);
  const conversionPrev = rate(raw.registrationsPrev.month, raw.sessionsPrev.month);
  const conversionDelta = pctChange(conversionValue, conversionPrev);
  const conversionRag = ragFor(conversionValue, MARKETING_TARGETS.conversionRate);

  const sessionsRag = ragFor(raw.sessions.month, MARKETING_TARGETS.sessionsMonthly);

  const totalChannelSessions = TRAFFIC_CHANNELS.reduce((sum, c) => sum + (raw.trafficSources[c] ?? 0), 0);
  const trafficSources = TRAFFIC_CHANNELS.map((channel) => {
    const sessions = raw.trafficSources[channel] ?? 0;
    return { channel, sessions, share: totalChannelSessions ? (sessions / totalChannelSessions) * 100 : 0 };
  }).sort((a, b) => b.sessions - a.sessions);

  const ctrValue = rate(raw.cta.clicks, raw.cta.views);
  const ctrPrev = rate(raw.ctaPrev.clicks, raw.ctaPrev.views);
  const ctrDelta = pctChange(ctrValue, ctrPrev);
  const ctrRag = ragFor(ctrValue, MARKETING_TARGETS.ctaCtr);

  const rags: Rag[] = [registrationsRag, conversionRag, sessionsRag, ctrRag];
  const scoreValue = Math.round(rags.reduce((s, r) => s + RAG_POINTS[r], 0) / rags.length);
  const scoreRag: Rag = scoreValue >= 85 ? "on_track" : scoreValue >= 60 ? "attention" : "critical";

  /* ---- explainability only: describes the maths above, never alters it ---- */
  const breakdown: ScoreContribution[] = [
    {
      key: "registrations",
      label: "Interest registrations",
      rag: registrationsRag,
      points: RAG_POINTS[registrationsRag],
      value: fmtInt(raw.registrations.month),
      target: fmtInt(MARKETING_TARGETS.registrationsMonthly.target),
    },
    {
      key: "conversion",
      label: "Visit-to-submission conversion",
      rag: conversionRag,
      points: RAG_POINTS[conversionRag],
      value: fmtPct(conversionValue),
      target: `${MARKETING_TARGETS.conversionRate.target}%`,
    },
    {
      key: "sessions",
      label: "Website sessions",
      rag: sessionsRag,
      points: RAG_POINTS[sessionsRag],
      value: fmtInt(raw.sessions.month),
      target: fmtInt(MARKETING_TARGETS.sessionsMonthly.target),
    },
    {
      key: "ctaCtr",
      label: "CTA click-through rate",
      rag: ctrRag,
      points: RAG_POINTS[ctrRag],
      value: fmtPct(ctrValue),
      target: `${MARKETING_TARGETS.ctaCtr.target}%`,
    },
  ];

  const formula = `(${breakdown.map((b) => b.points).join(" + ")}) / ${breakdown.length} = ${scoreValue}`;
  const summary = buildSummary(breakdown, scoreRag);

  return {
    live: raw.live,
    generatedAt: raw.generatedAt,
    registrations: {
      total: raw.registrations.month,
      periods: [
        period("Today", raw.registrations.today, raw.registrationsPrev.today),
        period("This week", raw.registrations.week, raw.registrationsPrev.week),
        period("This month", raw.registrations.month, raw.registrationsPrev.month),
      ],
      rag: registrationsRag,
    },
    conversion: {
      value: conversionValue,
      formatted: fmtPct(conversionValue),
      delta: conversionDelta,
      trend: trendFor(conversionDelta),
      rag: conversionRag,
    },
    sessions: {
      periods: [
        period("Daily", raw.sessions.today, raw.sessionsPrev.today),
        period("Weekly", raw.sessions.week, raw.sessionsPrev.week),
        period("Monthly", raw.sessions.month, raw.sessionsPrev.month),
      ],
      rag: sessionsRag,
    },
    trafficSources,
    ctaCtr: {
      value: ctrValue,
      formatted: fmtPct(ctrValue),
      clicks: raw.cta.clicks,
      views: raw.cta.views,
      delta: ctrDelta,
      trend: trendFor(ctrDelta),
      rag: ctrRag,
    },
    score: { value: scoreValue, rag: scoreRag, breakdown, formula, summary },
  };
}

/**
 * Marketing health data layer — LIVE.
 * Sessions / traffic sources / CTA events come from GA4 via the
 * `google-analytics-api` edge function (action: "marketing_health"),
 * registrations from `public.school_registrations` (aggregated server-side).
 * Falls back to placeholder numbers only when GA is not connected.
 */
export function useMarketingHealth(): MarketingHealth & { isLoading: boolean; error: Error | null } {
  const { session } = useAuth();

  const query = useQuery({
    queryKey: ["marketing-health", session?.user?.id],
    enabled: !!session,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MarketingRaw | null> => {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-analytics-api`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "marketing_health" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.code === "NOT_CONNECTED" || data.connected === false) return null;
      if (!res.ok) throw new Error(data.error || "Failed to load marketing analytics");

      const channels = (data.trafficSources ?? {}) as Record<string, number>;
      const trafficSources = Object.fromEntries(
        TRAFFIC_CHANNELS.map((c) => [c, Number(channels[c] ?? 0)]),
      ) as Record<TrafficChannel, number>;

      return {
        registrations: data.registrations,
        registrationsPrev: data.registrationsPrev,
        sessions: data.sessions,
        sessionsPrev: data.sessionsPrev,
        trafficSources,
        cta: data.cta,
        ctaPrev: data.ctaPrev,
        generatedAt: data.generatedAt,
        live: true,
      };
    },
  });

  const health = computeMarketingHealth(query.data ?? PLACEHOLDER_RAW);
  return { ...health, isLoading: query.isLoading, error: (query.error as Error) ?? null };
}
