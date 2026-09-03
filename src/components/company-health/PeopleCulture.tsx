import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePeopleCulture, type ScoreboardMetric } from "@/hooks/usePeopleCulture";

/**
 * People & Culture — monthly employee survey scoreboard.
 * SOURCE: employee survey Google Sheet, read + mapped by the `people-culture-metrics`
 * edge function (Q1/Q9 satisfaction, Q5/Q7/Q8 alignment, Q2/Q3/Q4/Q6 culture).
 * Team Voices themes come from `people-culture-comment-summary` (AI tagged, qualitative only).
 */

type Tone = "green" | "amber" | "red";

const toneFor = (score: number | null): Tone => {
  if (score === null) return "amber";
  if (score >= 4) return "green";
  if (score >= 3) return "amber";
  return "red";
};

const dotClass: Record<Tone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-destructive",
};

function Sparkline({ points }: { points: (number | null)[] }) {
  const vals = points.map((p) => (p === null ? null : p));
  const known = vals.filter((v): v is number => v !== null);
  if (known.length < 2) {
    return <div className="h-10 w-full rounded bg-muted/40" aria-hidden="true" />;
  }
  const min = Math.min(...known, 1);
  const max = Math.max(...known, 5);
  const span = max - min || 1;
  const w = 100;
  const h = 32;
  const step = w / (vals.length - 1);
  const coords = vals.map((v, i) => (v === null ? null : [i * step, h - ((v - min) / span) * h] as const));
  const path = coords
    .filter((c): c is readonly [number, number] => !!c)
    .map((c, i) => `${i === 0 ? "M" : "L"}${c[0].toFixed(1)},${c[1].toFixed(1)}`)
    .join(" ");
  const last = coords.filter((c): c is readonly [number, number] => !!c).slice(-1)[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full text-primary" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="1.8" fill="currentColor" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function MetricCard({ metric }: { metric: ScoreboardMetric }) {
  const tone = toneFor(metric.score);
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{metric.label}</p>
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", dotClass[tone])} aria-hidden="true" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-3xl font-bold tabular-nums text-foreground">
          {metric.score !== null ? metric.score.toFixed(1) : "—"}
          <span className="text-sm font-normal text-muted-foreground"> / 5</span>
        </p>
        {tone === "red" && (
          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
            Needs attention
          </span>
        )}
      </div>
      <Sparkline points={metric.trend.slice(-6).map((t) => t.score)} />
    </div>
  );
}

interface VoiceTag {
  label: string;
  count: number;
  tone?: "concern" | "mixed" | "positive";
}

export default function PeopleCulture() {
  const { data, isLoading, isFetching, refetch, error } = usePeopleCulture();
  const [tags, setTags] = useState<VoiceTag[] | null>(null);

  const comments = data?.comments ?? [];

  useEffect(() => {
    let cancelled = false;
    if (!comments.length) return;
    (async () => {
      const { data: res } = await supabase.functions.invoke("people-culture-comment-summary", {
        body: { comments },
      });
      const t = (res as any)?.summary?.tags;
      if (!cancelled && Array.isArray(t)) {
        setTags(
          t
            .filter((x: any) => x?.label)
            .map((x: any) => ({ label: String(x.label), count: Number(x.count) || 0, tone: x.tone }))
            .sort((a: VoiceTag, b: VoiceTag) => b.count - a.count),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.length]);

  const sb = data?.scoreboard ?? null;

  const monthLabel = useMemo(() => {
    if (!sb?.month) return null;
    const [y, m] = sb.month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }, [sb?.month]);

  const handleRefresh = async () => {
    const res = await refetch();
    if (res.error) {
      toast.error("Couldn't reach the survey sheet", { description: (res.error as Error).message });
      return;
    }
    toast.success(`Synced ${res.data?.responses ?? 0} survey responses`);
  };

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading employee satisfaction…</p>;
  }

  if (error || !sb) {
    return (
      <p className="text-[11px] italic text-muted-foreground">
        {error ? `Survey sync failed: ${(error as Error).message}` : "Awaiting the first survey responses."}
      </p>
    );
  }

  const overallTone = toneFor(sb.overall);
  const maxCount = Math.max(1, ...(tags ?? []).map((t) => t.count));

  return (
    <div className="space-y-5">
      {/* Top summary bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <p className="text-4xl font-bold tabular-nums text-foreground">
              {sb.overall !== null ? sb.overall.toFixed(1) : "—"}
              <span className="text-base font-normal text-muted-foreground"> / 5</span>
            </p>
            <span className={cn("h-2.5 w-2.5 rounded-full", dotClass[overallTone])} aria-hidden="true" />
          </div>
          <p className="text-[11px] text-muted-foreground">Average across all metrics</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">
            Based on {sb.responses} response{sb.responses === 1 ? "" : "s"} this month
          </p>
          {monthLabel && <p className="text-[11px] text-muted-foreground/70">{monthLabel}</p>}
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-7 gap-1.5 text-[11px] text-muted-foreground"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            {isFetching ? "Syncing…" : "Refresh from survey"}
          </Button>
        </div>
      </div>

      {/* Three metric cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {sb.metrics.map((m) => (
          <MetricCard key={m.key} metric={m} />
        ))}
      </div>

      {/* Team Voices */}
      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs font-medium text-foreground">Team Voices</p>
        {tags === null ? (
          <p className="text-[11px] text-muted-foreground">{comments.length ? "Tagging themes…" : "No open responses yet."}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => {
              const ratio = t.count / maxCount;
              const tone: Tone = t.tone === "positive" ? "green" : t.tone === "concern" ? "red" : ratio >= 0.66 ? "red" : ratio >= 0.33 ? "amber" : "green";
              return (
                <span
                  key={t.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-foreground"
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", dotClass[tone])} aria-hidden="true" />
                  {t.label} ({t.count})
                </span>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70">All responses are anonymous</p>
      </div>
    </div>
  );
}
