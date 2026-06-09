import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { PageGroup } from "./PagesAnalytics";

const ANALYTICS_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-analytics-api`;

function fmt(n: number) {
  return new Intl.NumberFormat().format(Math.round(n || 0));
}
function fmtPct(rate: number) {
  return `${((rate || 0) * 100).toFixed(1)}%`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function GlobalRegistrationsSummary({
  totalRegistrations,
  groups,
}: {
  totalRegistrations: number;
  groups: PageGroup[];
}) {
  const { session } = useAuth();

  const query = useQuery({
    queryKey: ["ga-global-summary", groups.map((g) => g.key).join("|"), session?.user?.id],
    enabled: !!session,
    retry: false,
    queryFn: async () => {
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
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
  });

  const s = query.data?.overall?.summary;
  const loading = query.isLoading;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Global Summary
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Last 30 days · combined Schools + KPL
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile label="Total Registrations" value={fmt(totalRegistrations)} sub="All-time submissions" />
        <Tile
          label="Total Users"
          value={loading ? "…" : s ? fmt(s.users) : "—"}
          sub={!s && !loading ? "GA not connected" : undefined}
        />
        <Tile
          label="Total Page Views"
          value={loading ? "…" : s ? fmt(s.pageViews) : "—"}
        />
        <Tile
          label="Total Sessions"
          value={loading ? "…" : s ? fmt(s.sessions) : "—"}
        />
        <Tile
          label="Engagement Rate"
          value={loading ? "…" : s ? fmtPct(s.engagementRate) : "—"}
        />
      </div>
      {loading && (
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading analytics…
        </div>
      )}
    </section>
  );
}
