import { useState } from "react";
import { ChevronRight, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { RagBadge, TrendIcon } from "@/components/company-health/HealthPrimitives";
import { useAiEfficiency, type Metric } from "@/hooks/useAiEfficiency";

/**
 * Executive AI Efficiency dashboard.
 * All numbers come live from src/hooks/useAiEfficiency.ts (RPC over
 * savings_events / effort_savings_config / token_usage). Metrics without a
 * live source render as "Awaiting integration" — never as mock values.
 */

function MetricRow({ m }: { m: Metric }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground min-w-0">
        {m.label}
        {m.sub && <span className="block text-[10px] text-muted-foreground/70 mt-0.5">{m.sub}</span>}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            m.awaiting ? "text-[10px] font-mono uppercase tracking-wide text-muted-foreground/70" : "text-foreground"
          )}
        >
          {m.value}
        </span>
        {!m.awaiting && <TrendIcon trend={m.trend} delta={m.deltaPct ?? undefined} />}
        {m.rag && <RagBadge rag={m.rag} />}
      </span>
    </div>
  );
}

function Block({ title, metrics }: { title: string; metrics: Metric[] }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">{title}</p>
      <div>{metrics.map((m) => <MetricRow key={m.label} m={m} />)}</div>
    </div>
  );
}

export default function AiEfficiency() {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const d = useAiEfficiency();

  if (d.loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading live AI usage…
      </div>
    );
  }

  if (d.error) {
    return (
      <div className="flex items-start gap-2 py-6 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          {d.restricted
            ? "Workspace-wide AI efficiency metrics are restricted to admins."
            : `Unable to load AI efficiency metrics: ${d.error}`}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Score header — click to expand the calculation */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left rounded-lg border border-border bg-background/40 p-3 hover:bg-background/70 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
            <span className="text-xs text-muted-foreground">Efficiency Health Score</span>
          </div>
          <span className="flex items-center gap-2 shrink-0">
            <span className="text-xl font-bold tabular-nums text-foreground">{d.score ?? "—"}</span>
            {d.scoreRag && <RagBadge rag={d.scoreRag} size="md" />}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug mt-2">{d.summary}</p>
      </button>

      {open && (
        <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">How this is calculated</p>
          {d.components.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground min-w-0">
                {c.awaiting ? "○" : "✓"} {c.label} <span className="text-muted-foreground/60">({Math.round(c.weight * 100)}%)</span>
                <span className="block text-[10px] text-muted-foreground/70">{c.detail}</span>
              </span>
              <span className="shrink-0 flex items-center gap-2">
                {c.rag && <RagBadge rag={c.rag} />}
                <span className="tabular-nums font-semibold text-foreground">{c.points ?? "n/a"}</span>
              </span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground font-mono pt-2 border-t border-border break-words">{d.scoreFormula}</p>
          <p className="text-[10px] text-muted-foreground/70">
            Unavailable components are excluded and the remaining weights are re-normalised, so the score never leans on estimated values.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <Block title="Hours saved" metrics={d.hoursSaved} />
        <Block title="Adoption — active AI users" metrics={d.activeUsers} />
        <Block title="Productivity" metrics={d.headline} />
        {showAll && (
          <>
            <Block title="Tokens consumed" metrics={d.tokens} />
            <Block title="AI requests" metrics={d.requests} />
            <Block title="Tool success rate" metrics={d.toolSuccess} />
            <Block title="AI cost" metrics={d.cost} />
            <Block title="Cost vs value" metrics={d.costVsValue} />
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">Top tools · 30 days</p>
              {d.topTools.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No recorded actions in the last 30 days.</p>
              ) : (
                <ol className="divide-y divide-border">
                  {d.topTools.slice(0, 5).map((t, i) => (
                    <li key={t.label} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-xs text-muted-foreground min-w-0 truncate">
                        <span className="font-mono text-muted-foreground/60 mr-2">{i + 1}</span>
                        {t.label}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-foreground font-semibold">
                        {t.uses} <span className="font-normal text-muted-foreground">uses</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAll ? "Show less" : "Show all metrics — tokens, requests, cost, ROI, top tools"}
      </button>

      {d.generatedAt && (
        <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/70">
          Live from savings_events · token_usage · effort_savings_config — refreshed every 5 min
        </p>
      )}
    </div>
  );
}
