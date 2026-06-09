import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertCircle, Globe, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PageGroup = { key: string; label: string; paths: string[] };

const ANALYTICS_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-analytics-api`;

type Pair = { label: string; users?: number; sessions?: number };
type Summary = {
  pageViews: number;
  users: number;
  sessions: number;
  engagementRate: number;
  avgEngagementTimeSec: number;
  avgSessionDurationSec: number;
};
type GroupResult = {
  key: string;
  label: string;
  paths: string[];
  summary: Summary;
  sources: Pair[];
  countries: Pair[];
  cities: Pair[];
  devices: Pair[];
};
type Response = {
  connected?: boolean;
  code?: string;
  overall: { summary: Summary; sources: Pair[]; countries: Pair[]; cities: Pair[]; devices: Pair[] };
  groups: GroupResult[];
  generatedAt: string;
};

function fmt(n: number) {
  return new Intl.NumberFormat().format(Math.round(n));
}
function fmtDuration(sec: number) {
  if (!sec || !Number.isFinite(sec)) return "0s";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}
function fmtPct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MetricRow({ summary }: { summary: Summary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <MetricTile label="Page Views" value={fmt(summary.pageViews)} />
      <MetricTile label="Users" value={fmt(summary.users)} />
      <MetricTile label="Sessions" value={fmt(summary.sessions)} />
      <MetricTile label="Engagement Rate" value={fmtPct(summary.engagementRate)} />
      <MetricTile label="Avg Engagement" value={fmtDuration(summary.avgEngagementTimeSec)} />
      <MetricTile label="Avg Session" value={fmtDuration(summary.avgSessionDurationSec)} />
    </div>
  );
}

function MiniList({ title, items, metric = "users" }: { title: string; items: Pair[]; metric?: "users" | "sessions" }) {
  const max = Math.max(1, ...items.map((i) => (metric === "users" ? (i.users ?? 0) : (i.sessions ?? 0))));
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 5).map((it) => {
            const v = metric === "users" ? (it.users ?? 0) : (it.sessions ?? 0);
            const pct = (v / max) * 100;
            return (
              <li key={it.label} className="flex items-center gap-2 text-xs">
                <span className="w-28 truncate font-medium" title={it.label}>
                  {it.label || "—"}
                </span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right text-muted-foreground tabular-nums">{fmt(v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GroupBlock({
  label,
  paths,
  summary,
  sources,
  countries,
  cities,
  devices,
}: {
  label: string;
  paths?: string[];
  summary: Summary;
  sources: Pair[];
  countries: Pair[];
  cities: Pair[];
  devices: Pair[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            {label}
          </CardTitle>
          {paths && (
            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[60%]" title={paths.join(", ")}>
              {paths.join(", ")}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <MetricRow summary={summary} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
          <MiniList title="Top Traffic Sources" items={sources} metric="sessions" />
          <MiniList title="Top Countries" items={countries} />
          <MiniList title="Top Cities" items={cities} />
          <MiniList title="Device Breakdown" items={devices} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PagesAnalytics({
  title = "Schools & Kabuni Premier League Analytics",
  groups,
}: {
  title?: string;
  groups: PageGroup[];
}) {
  const { session } = useAuth();

  const query = useQuery({
    queryKey: ["ga-pages-analytics", groups.map((g) => g.key).join("|"), session?.user?.id],
    enabled: !!session,
    retry: false,
    queryFn: async (): Promise<Response | null> => {
      const res = await fetch(ANALYTICS_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "pages_analytics", pages: groups }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.code === "NOT_CONNECTED" || data.connected === false) return null;
      if (!res.ok) throw new Error(data.error || "Failed to load page analytics");
      return data as Response;
    },
  });

  return (
    <section className="space-y-3 mb-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="text-xs text-muted-foreground">Last 30 days · via Google Analytics</span>
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading analytics…
          </CardContent>
        </Card>
      ) : query.error ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {(query.error as Error).message}
          </CardContent>
        </Card>
      ) : !query.data ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Google Analytics isn't connected yet. Connect it in Settings → Integrations to see page-level analytics here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <GroupBlock
            label="Overall summary"
            summary={query.data.overall.summary}
            sources={query.data.overall.sources}
            countries={query.data.overall.countries}
            cities={query.data.overall.cities}
            devices={query.data.overall.devices}
          />
          {query.data.groups.map((g) => (
            <GroupBlock
              key={g.key}
              label={g.label}
              paths={g.paths}
              summary={g.summary}
              sources={g.sources}
              countries={g.countries}
              cities={g.cities}
              devices={g.devices}
            />
          ))}
        </div>
      )}
    </section>
  );
}
