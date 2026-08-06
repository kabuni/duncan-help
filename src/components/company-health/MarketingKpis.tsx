import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useMarketingHealth } from "@/hooks/useMarketingHealth";
import { RagBadge, TrendIcon, ragConfig } from "@/components/company-health/HealthPrimitives";
import { cn } from "@/lib/utils";

/* Marketing KPI dashboard — website & funnel performance.
   All numbers/derivations come from useMarketingHealth(); this file is render-only. */

function KpiBlock({
  title,
  hint,
  target,
  rag,
  children,
}: {
  title: string;
  hint?: string;
  target?: string;
  rag?: React.ComponentProps<typeof RagBadge>["rag"];
  children: React.ReactNode;
}) {
  return (
    <div className="py-3 border-b border-border last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{title}</p>
          {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {target && (
            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">Target: {target}</span>
          )}
          {rag && <RagBadge rag={rag} />}
        </div>
      </div>
      {children}
    </div>
  );
}

function PeriodGrid({ periods }: { periods: ReturnType<typeof useMarketingHealth>["sessions"]["periods"] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {periods.map((p) => (
        <div key={p.label}>
          <p className="text-lg font-bold tabular-nums text-foreground leading-tight">{p.formatted}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{p.label}</p>
            <TrendIcon trend={p.trend} delta={p.delta} />
          </div>
        </div>
      ))}
    </div>
  );
}

const RAG_MARK: Record<string, string> = { on_track: "✓", attention: "⚠", critical: "✗" };

export default function MarketingKpis() {
  const m = useMarketingHealth();
  const [open, setOpen] = useState(false);
  const byKey = Object.fromEntries(m.score.breakdown.map((b) => [b.key, b]));

  return (
    <div className="space-y-1">
      {/* Marketing health score — roll-up of the four scored KPIs (expandable for explainability) */}
      <div className="pb-3 border-b border-border">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-3 text-left rounded-md hover:bg-muted/50 transition-colors px-1 -mx-1 py-1"
        >
          <div className="flex items-baseline gap-2 min-w-0">
            <ChevronRight
              className={cn("h-3.5 w-3.5 self-center shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
              aria-hidden="true"
            />
            <span className="text-2xl font-bold tabular-nums text-foreground">{m.score.value}</span>
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">Marketing health score</span>
          </div>
          <RagBadge rag={m.score.rag} size="md" />
        </button>

        {/* Auto-generated executive summary */}
        <p className="mt-2 pl-6 text-[11px] leading-5 text-muted-foreground">{m.score.summary}</p>

        {open && (
          <div className="mt-3 ml-6 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Derived from</p>
            <ul className="space-y-1.5">
              {m.score.breakdown.map((b) => (
                <li key={b.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={cn("w-3 text-center", ragConfig[b.rag].text)} aria-hidden="true">{RAG_MARK[b.rag]}</span>
                    <span className="truncate text-foreground">{b.label}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0 tabular-nums">
                    <span className="text-[10px] text-muted-foreground">{b.value} / target {b.target}</span>
                    <span className={ragConfig[b.rag].text}>{ragConfig[b.rag].label} ({b.points})</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-2 border-t border-border">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Overall score</p>
              <p className="text-xs font-mono tabular-nums text-foreground mt-0.5">{m.score.formula}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Points: on track = 100, attention = 65, critical = 30. Badge: ≥85 green, ≥60 amber, else red.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 1. Interest Registration Submissions — SOURCE: public.school_registrations */}
      <KpiBlock
        title="Interest registration submissions"
        hint="Duncan registrations · vs previous period"
        target={byKey.registrations?.target}
        rag={m.registrations.rag}
      >
        <PeriodGrid periods={m.registrations.periods} />
      </KpiBlock>

      {/* 2. Visit-to-Submission Conversion — SOURCE: registrations ÷ GA4 sessions */}
      <KpiBlock
        title="Visit-to-submission conversion"
        hint="Submissions ÷ sessions (30d)"
        target={byKey.conversion?.target}
        rag={m.conversion.rag}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums text-foreground">{m.conversion.formatted}</span>
          <TrendIcon trend={m.conversion.trend} delta={m.conversion.delta} />
        </div>
      </KpiBlock>

      {/* 3. Website Sessions — SOURCE: GA4 `sessions` */}
      <KpiBlock title="Website sessions" hint="GA4 · vs previous period" target={byKey.sessions?.target} rag={m.sessions.rag}>
        <PeriodGrid periods={m.sessions.periods} />
      </KpiBlock>


      {/* 4. Traffic Sources — SOURCE: GA4 sessionDefaultChannelGroup */}
      <KpiBlock title="Traffic sources" hint="Share of sessions (30d)">
        <ul className="space-y-1.5">
          {m.trafficSources.map((s) => (
            <li key={s.channel} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate text-muted-foreground" title={s.channel}>{s.channel}</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${s.share}%` }} />
              </div>
              <span className="w-11 text-right tabular-nums text-foreground">{s.share.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </KpiBlock>

      {/* 5. CTA CTR — SOURCE: GA4 events cta_click / cta_view */}
      <KpiBlock title="CTA click-through rate" hint="cta_click ÷ cta_view (30d)" target={byKey.ctaCtr?.target} rag={m.ctaCtr.rag}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums text-foreground">{m.ctaCtr.formatted}</span>
          <TrendIcon trend={m.ctaCtr.trend} delta={m.ctaCtr.delta} />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {new Intl.NumberFormat().format(m.ctaCtr.clicks)} / {new Intl.NumberFormat().format(m.ctaCtr.views)}
          </span>
        </div>
      </KpiBlock>

      {m.isLoading ? (
        <p className="pt-3 text-[10px] text-muted-foreground">Loading live marketing data…</p>
      ) : m.error ? (
        <p className="pt-3 text-[10px] text-destructive">{m.error.message}</p>
      ) : !m.live ? (
        <p className={cn("pt-3 text-[10px] text-muted-foreground")}>
          Placeholder data — Google Analytics isn't connected. Connect it in Settings → Integrations for live numbers.
        </p>
      ) : null}
    </div>
  );
}
