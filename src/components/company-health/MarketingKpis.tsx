import { useMarketingHealth } from "@/hooks/useMarketingHealth";
import { RagBadge, TrendIcon } from "@/components/company-health/HealthPrimitives";
import { cn } from "@/lib/utils";

/* Marketing KPIs — grouped into Website (live GA4) and Social Media.
   No roll-up health score by design; each metric stands on its own.
   All numbers/derivations come from useMarketingHealth(); this file is render-only. */

function GroupHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="pt-1 pb-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {hint && <p className="text-[10px] text-muted-foreground/80 mt-0.5">{hint}</p>}
    </div>
  );
}

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

/* Social channels — SOURCE: not yet connected. Rendered explicitly as
   "Awaiting integration" so nothing here is mistaken for live data. */
const SOCIAL_CHANNELS = [
  { channel: "LinkedIn", metric: "Followers · engagement rate" },
  { channel: "Instagram", metric: "Followers · engagement rate" },
  { channel: "X (Twitter)", metric: "Followers · impressions" },
  { channel: "Facebook", metric: "Page likes · reach" },
];

export default function MarketingKpis() {
  const m = useMarketingHealth();
  const byKey = Object.fromEntries(m.score.breakdown.map((b) => [b.key, b]));

  return (
    <div className="space-y-1">
      {/* ---------------- Website (live GA4) ---------------- */}
      <GroupHeading title="Website" hint="Live Google Analytics 4 — single source of truth" />

      {/* Website Sessions — SOURCE: GA4 `sessions` */}
      <KpiBlock title="Website sessions" hint="GA4 · vs previous period" target={byKey.sessions?.target} rag={m.sessions.rag}>
        <PeriodGrid periods={m.sessions.periods} />
      </KpiBlock>




      {/* Traffic Sources — SOURCE: GA4 sessionDefaultChannelGroup */}
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

      {m.isLoading ? (
        <p className="pt-3 text-[10px] text-muted-foreground">Loading live GA4 marketing data…</p>
      ) : m.error ? (
        <p className="pt-3 text-[10px] text-destructive">{m.error.message}</p>
      ) : !m.live ? (
        <p className={cn("pt-3 text-[10px] text-muted-foreground")}>
          Google Analytics isn't connected — showing zeros, not sample data. Connect GA4 in Settings → Integrations.
        </p>
      ) : (
        <p className="pt-3 text-[10px] text-muted-foreground">Live GA4 data.</p>
      )}


      {/* ---------------- Social Media ---------------- */}
      <div className="mt-4 pt-3 border-t border-border">
        <GroupHeading title="Social media" hint="Reach and engagement per channel" />
        <ul className="space-y-2">
          {SOCIAL_CHANNELS.map((c) => (
            <li key={c.channel} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{c.channel}</p>
                <p className="text-[10px] text-muted-foreground">{c.metric}</p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">Awaiting integration</span>
            </li>
          ))}
        </ul>
        <p className="pt-3 text-[10px] text-muted-foreground">
          No social account is connected yet — connect LinkedIn, Instagram, X or Facebook to populate these metrics.
        </p>
      </div>
    </div>
  );
}
