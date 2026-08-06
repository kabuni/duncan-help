import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, HeartPulse } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import MarketingKpis from "@/components/company-health/MarketingKpis";
import AiEfficiency from "@/components/company-health/AiEfficiency";
import PeopleCulture from "@/components/company-health/PeopleCulture";
import { useAiEfficiency } from "@/hooks/useAiEfficiency";
import { useProductAdoption } from "@/hooks/useProductAdoption";
import { usePeopleCulture } from "@/hooks/usePeopleCulture";




/* ------------------------------------------------------------------
   MOCK DATA — single typed object.
   Swap each block for a real source when the API lands:
     • companyHealth / schools  -> 90-Day Tracker + CRM (schools pipeline)
     • product                  -> Duncan analytics (uploads, active users, workflows)
     • efficiency               -> model usage logs (token_usage / savings_events)
     • finance                  -> Finance system (cashflow, burn, plan variance)
     • staff                    -> 90-Day Tracker commitments + OKR store
     • operational              -> platform/ops telemetry
------------------------------------------------------------------- */

type Rag = "on_track" | "attention" | "critical";
type Trend = "up" | "down" | "flat";

interface HealthTile {
  area: string;
  descriptor: string;
  rag: Rag;
}
interface Stat {
  label: string;
  value: string;
  trend?: Trend;
  rag?: Rag;
}
interface StaffRow {
  name: string;
  commitmentsMet: number;
  commitmentsTotal: number;
  okrProgress: number;
  predictability: string;
  blockersResolved: number;
  rag: Rag;
}
interface DashboardData {
  lastUpdated: string;
  companyHealth: HealthTile[];
  schools: {
    signed: number;
    target: number;
    weeklyGrowth: number;
    forecast: string;
    forecastRag: Rag;
    stages: { label: string; count: number }[];
  };
  product: Stat[];
  finance: Stat[];
  staff: StaffRow[];
  
}

const DATA: DashboardData = {
  lastUpdated: "4 Aug 2026, 14:20 BST",

  // SOURCE: aggregate roll-up of the four domains below
  companyHealth: [
    { area: "Commercial Growth", descriptor: "Schools signed vs target", rag: "attention" },
    { area: "Product Adoption", descriptor: "Uploads, usage and throughput", rag: "on_track" },
    { area: "Financial Health", descriptor: "Variance", rag: "attention" },
    { area: "Marketing Impact", descriptor: "Reach, pipeline contribution and campaign ROI", rag: "attention" },
    
    
  ],


  // SOURCE: CRM + 90-Day Tracker
  schools: {
    signed: 120,
    target: 400,
    weeklyGrowth: 8,
    forecast: "Behind target",
    forecastRag: "attention",
    stages: [
      { label: "Prospect", count: 412 },
      { label: "Pipeline", count: 186 },
      { label: "Signed", count: 120 },
    ],
  },

  // SOURCE: Duncan analytics (shots uploaded). Tickets + velocity are LIVE from
  // Azure DevOps via src/hooks/useProductAdoption.ts and are injected at render.
  product: [
    { label: "Shots uploaded", value: "342", trend: "up", rag: "on_track" },
  ],


  // Marketing KPIs now live in src/hooks/useMarketingHealth.ts (GA4 + registrations)



  // AI Efficiency now lives in src/hooks/useAiEfficiency.ts (live usage data)

  // SOURCE: Finance system
  finance: [
    { label: "Cashflow position", value: "£2.41M", trend: "down", rag: "on_track" },
    { label: "Burn (monthly)", value: "£312k", trend: "up", rag: "attention" },
    // RAG rule: green within ±10%, red at -10% or worse
    { label: "Variance vs plan", value: "-12.4%", trend: "down", rag: "critical" },
  ],

  // SOURCE: 90-Day Tracker commitments + OKR store
  staff: [
    { name: "Product", commitmentsMet: 11, commitmentsTotal: 12, okrProgress: 78, predictability: "High", blockersResolved: 9, rag: "on_track" },
    { name: "Engineering", commitmentsMet: 14, commitmentsTotal: 18, okrProgress: 64, predictability: "Medium", blockersResolved: 12, rag: "attention" },
    { name: "Sales", commitmentsMet: 6, commitmentsTotal: 15, okrProgress: 41, predictability: "Low", blockersResolved: 4, rag: "critical" },
    { name: "Operations", commitmentsMet: 9, commitmentsTotal: 10, okrProgress: 82, predictability: "High", blockersResolved: 7, rag: "on_track" },
    { name: "Marketing", commitmentsMet: 7, commitmentsTotal: 11, okrProgress: 58, predictability: "Medium", blockersResolved: 5, rag: "attention" },
  ],

  // Operational telemetry now lives in src/hooks/useOperationalHealth.ts (live)

};

/* ---------------------------- primitives ---------------------------- */

const ragConfig: Record<Rag, { label: string; bg: string; text: string; dot: string; border: string }> = {
  on_track: { label: "On track", bg: "bg-emerald-500/10", text: "text-emerald-500", dot: "bg-emerald-500", border: "border-emerald-500/30" },
  attention: { label: "Attention", bg: "bg-amber-500/10", text: "text-amber-500", dot: "bg-amber-500", border: "border-amber-500/30" },
  critical: { label: "Critical", bg: "bg-red-500/10", text: "text-red-500", dot: "bg-red-500", border: "border-red-500/30" },
};

function RagBadge({ rag, size = "sm" }: { rag: Rag; size?: "sm" | "md" }) {
  const c = ragConfig[rag];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        c.bg, c.text, c.border,
        size === "md" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10px]"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden="true" />
      {c.label}
    </span>
  );
}

const trendMeta: Record<Trend, { Icon: typeof ArrowUpRight; label: string; className: string }> = {
  up: { Icon: ArrowUpRight, label: "Trending up", className: "text-emerald-500" },
  down: { Icon: ArrowDownRight, label: "Trending down", className: "text-red-500" },
  flat: { Icon: ArrowRight, label: "Flat", className: "text-muted-foreground" },
};

function TrendIcon({ trend }: { trend?: Trend }) {
  if (!trend) return null;
  const { Icon, label, className } = trendMeta[trend];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide", className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function StatRow({ stat }: { stat: Stat }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground min-w-0 break-words">{stat.label}</span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-semibold tabular-nums text-foreground">{stat.value}</span>
        <TrendIcon trend={stat.trend} />
        {stat.rag && <RagBadge rag={stat.rag} />}
      </span>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------- page ------------------------------- */

export default function CompanyHealth() {
  const d = DATA;
  // Live AI efficiency roll-up feeds the Company Health tile (react-query dedupes the fetch)
  const ai = useAiEfficiency();
  // Live Azure DevOps ticket counts + derived velocity
  const product = useProductAdoption();
  const schoolsPct = Math.round((d.schools.signed / d.schools.target) * 100);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />
      <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary glow-primary-sm shrink-0">
              <HeartPulse className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
                Kabuni Company &amp; People Health
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Powered by Duncan
              </p>
            </div>
          </div>
        </header>

        {/* 1. Company Health Score */}
        <section aria-labelledby="company-health-heading" className="space-y-3">
          <h2 id="company-health-heading" className="text-sm font-semibold text-foreground tracking-tight">
            Company Health Score
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              ...d.companyHealth,
              {
                area: "People & Culture",
                descriptor: "Engagement, retention and team health",
                rag: "attention" as Rag,
              },
              {
                area: "AI Efficiency",
                descriptor: "Hours saved, adoption and usage",
                rag: ai.scoreRag ?? ("attention" as Rag),
              },
            ].map((tile) => (
              <div key={tile.area} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
                <p className="text-sm font-semibold text-foreground leading-tight">{tile.area}</p>
                <p className="text-[11px] text-muted-foreground leading-snug flex-1">{tile.descriptor}</p>
                <RagBadge rag={tile.rag} />
              </div>
            ))}
          </div>
        </section>

        {/* 2. Strategic Metrics */}
        <section aria-labelledby="strategic-heading" className="space-y-3">
          <h2 id="strategic-heading" className="text-sm font-semibold text-foreground tracking-tight">
            Strategic Metrics
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Schools & Pipeline — SOURCE: CRM + 90-Day Tracker */}
            <SectionCard title="Commercial Growth" subtitle="Schools signed vs target">
              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {d.schools.signed} <span className="text-base font-medium text-muted-foreground">/ {d.schools.target}</span>
                  </p>
                  <RagBadge rag={d.schools.forecastRag} size="md" />
                </div>
                <div className="space-y-1">
                  <Progress value={schoolsPct} aria-label={`${schoolsPct}% of target signed`} />
                  <p className="text-[11px] text-muted-foreground tabular-nums">{schoolsPct}% of target</p>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <span className="text-muted-foreground">
                    Weekly growth: <span className="font-semibold text-foreground tabular-nums">+{d.schools.weeklyGrowth}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Forecast: <span className="font-semibold text-foreground">{d.schools.forecast}</span>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                  {d.schools.stages.map((s) => (
                    <div key={s.label}>
                      <p className="text-lg font-bold tabular-nums text-foreground">{s.count}</p>
                      <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            {/* Product Measurement — SOURCE: Duncan analytics */}
            <SectionCard title="Product Adoption" subtitle="Uploads, usage and throughput">
              <div>
                {d.product.map((s) => <StatRow key={s.label} stat={s} />)}
                <StatRow
                  stat={{
                    label: "Tickets open / closed (Azure DevOps)",
                    value: product.tickets?.formatted ?? (product.isLoading ? "…" : "—"),
                  }}
                />
                <StatRow
                  stat={{
                    label: "Velocity (tickets closed / week)",
                    value: product.velocity?.formatted ?? (product.isLoading ? "…" : "—"),
                    trend: product.velocity?.trend,
                  }}
                />
              </div>
              {product.error && (
                <p className="pt-2 text-[10px] text-destructive">
                  Azure DevOps unavailable: {product.error.message}
                </p>
              )}
            </SectionCard>


            {/* Marketing — SOURCE: GA4 (sessions, channels, cta_view/cta_click) + Duncan registrations.
                Data + RAG live in src/hooks/useMarketingHealth.ts */}
            <SectionCard title="Marketing Impact" subtitle="Reach, pipeline contribution and campaign ROI">
              <MarketingKpis />
            </SectionCard>
            {/* Finance — SOURCE: Finance system */}

            <SectionCard title="Financial Health" subtitle="Variance — green within ±10% of plan, red at -10% or worse">
              <div>{d.finance.map((s) => <StatRow key={s.label} stat={s} />)}</div>
            </SectionCard>
          </div>
        </section>

        {/* 3. AI Efficiency — SOURCE: savings_events + effort_savings_config + token_usage
             via public.get_ai_efficiency_metrics(). Logic lives in src/hooks/useAiEfficiency.ts */}
        <section aria-labelledby="ai-efficiency-heading" className="space-y-3">
          <h2 id="ai-efficiency-heading" className="text-sm font-semibold text-foreground tracking-tight">
            AI Efficiency
          </h2>
          <SectionCard title="Duncan productivity impact" subtitle="Live executive view — hours saved, adoption, usage and business value">
            <AiEfficiency />
          </SectionCard>
        </section>


      </div>
    </main>
  );
}
