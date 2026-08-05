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

export default function MarketingKpis() {
  const m = useMarketingHealth();

  return (
    <div className="space-y-1">
      {/* Marketing health score — roll-up of the four scored KPIs */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-foreground">{m.score.value}</span>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Marketing health score</span>
        </div>
        <RagBadge rag={m.score.rag} size="md" />
      </div>

      {/* 1. Interest Registration Submissions — SOURCE: public.school_registrations */}
      <KpiBlock title="Interest registration submissions" hint="Duncan registrations · vs previous period" rag={m.registrations.rag}>
        <PeriodGrid periods={m.registrations.periods} />
      </KpiBlock>

      {/* 2. Visit-to-Submission Conversion — SOURCE: registrations ÷ GA4 sessions */}
      <KpiBlock title="Visit-to-submission conversion" hint="Submissions ÷ sessions (30d)" rag={m.conversion.rag}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums text-foreground">{m.conversion.formatted}</span>
          <TrendIcon trend={m.conversion.trend} delta={m.conversion.delta} />
        </div>
      </KpiBlock>

      {/* 3. Website Sessions — SOURCE: GA4 `sessions` */}
      <KpiBlock title="Website sessions" hint="GA4 · vs previous period" rag={m.sessions.rag}>
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
      <KpiBlock title="CTA click-through rate" hint="cta_click ÷ cta_view (30d)" rag={m.ctaCtr.rag}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums text-foreground">{m.ctaCtr.formatted}</span>
          <TrendIcon trend={m.ctaCtr.trend} delta={m.ctaCtr.delta} />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {new Intl.NumberFormat().format(m.ctaCtr.clicks)} / {new Intl.NumberFormat().format(m.ctaCtr.views)}
          </span>
        </div>
      </KpiBlock>

      {!m.live && (
        <p className={cn("pt-3 text-[10px] text-muted-foreground")}>
          Placeholder data — awaiting GA4 event wiring (cta_view / cta_click) and registrations aggregation.
        </p>
      )}
    </div>
  );
}
