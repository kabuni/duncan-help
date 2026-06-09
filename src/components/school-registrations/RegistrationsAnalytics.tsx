import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type Row = {
  id: string;
  role: string | null;
  number_of_schools: number | null;
  email: string;
  created_at: string;
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysAgo = (n: number) => {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() - n);
  return d;
};

function pct(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? null : 0;
  return ((curr - prev) / prev) * 100;
}

function DeltaPill({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-muted-foreground">new</span>;
  }
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> 0%
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

function Kpi({ label, value, delta, sub }: { label: string; value: number; delta?: number | null; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="text-2xl font-semibold">{value}</div>
          {delta !== undefined && <DeltaPill value={delta} />}
        </div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function RegistrationsAnalytics({ rows }: { rows: Row[] }) {
  const stats = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const yest = daysAgo(1);
    const d7 = daysAgo(7);
    const d14 = daysAgo(14);
    const d30 = daysAgo(30);
    const d60 = daysAgo(60);

    let countToday = 0,
      countYest = 0,
      count7 = 0,
      countPrev7 = 0,
      count30 = 0,
      countPrev30 = 0;

    // Daily buckets for last 30 days
    const dailyMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = daysAgo(i);
      dailyMap.set(d.toISOString().slice(0, 10), 0);
    }

    const roleMap = new Map<string, number>();
    const domainMap = new Map<string, number>();
    const schoolBuckets = { "1": 0, "2–5": 0, "6–20": 0, "21–100": 0, "100+": 0 };
    let totalSchools = 0;
    let schoolsCount = 0;

    for (const r of rows) {
      const t = new Date(r.created_at);
      if (t >= today) countToday++;
      else if (t >= yest && t < today) countYest++;
      if (t >= d7) count7++;
      else if (t >= d14 && t < d7) countPrev7++;
      if (t >= d30) count30++;
      else if (t >= d60 && t < d30) countPrev30++;

      if (t >= d30) {
        const key = startOfDay(t).toISOString().slice(0, 10);
        if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      }

      const role = (r.role ?? "Unspecified").trim() || "Unspecified";
      roleMap.set(role, (roleMap.get(role) ?? 0) + 1);

      const domain = r.email?.split("@")[1]?.toLowerCase().trim();
      if (domain) domainMap.set(domain, (domainMap.get(domain) ?? 0) + 1);

      const n = r.number_of_schools ?? 0;
      if (n > 0) {
        totalSchools += n;
        schoolsCount++;
        if (n === 1) schoolBuckets["1"]++;
        else if (n <= 5) schoolBuckets["2–5"]++;
        else if (n <= 20) schoolBuckets["6–20"]++;
        else if (n <= 100) schoolBuckets["21–100"]++;
        else schoolBuckets["100+"]++;
      }
    }

    const daily = Array.from(dailyMap.entries()).map(([date, count]) => ({
      date: date.slice(5),
      count,
    }));

    const roles = Array.from(roleMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const domains = Array.from(domainMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const schools = Object.entries(schoolBuckets).map(([name, count]) => ({ name, count }));

    return {
      total: rows.length,
      countToday,
      deltaToday: pct(countToday, countYest),
      count7,
      delta7: pct(count7, countPrev7),
      count30,
      delta30: pct(count30, countPrev30),
      avgSchools: schoolsCount > 0 ? totalSchools / schoolsCount : 0,
      daily,
      roles,
      domains,
      schools,
    };
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total" value={stats.total} sub="All-time submissions" />
        <Kpi label="Today" value={stats.countToday} delta={stats.deltaToday} sub="vs yesterday" />
        <Kpi label="Last 7 days" value={stats.count7} delta={stats.delta7} sub="vs prior 7d" />
        <Kpi label="Last 30 days" value={stats.count30} delta={stats.delta30} sub="vs prior 30d" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Submissions — last 30 days</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval={3}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">By role</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {stats.roles.map((r) => {
                const pctVal = stats.total ? (r.count / stats.total) * 100 : 0;
                return (
                  <li key={r.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground">
                        {r.count} · {pctVal.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pctVal}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Number of schools <span className="text-xs text-muted-foreground font-normal">· avg {stats.avgSchools.toFixed(1)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {stats.schools.map((s) => {
                const pctVal = stats.total ? (s.count / stats.total) * 100 : 0;
                return (
                  <li key={s.name} className="flex items-center gap-3 text-xs">
                    <span className="w-16 font-medium">{s.name}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pctVal}%` }} />
                    </div>
                    <span className="w-12 text-right text-muted-foreground tabular-nums">{s.count}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top email domains</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.domains.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data</p>
            ) : (
              <ul className="space-y-2">
                {stats.domains.map((d) => {
                  const pctVal = stats.total ? (d.count / stats.total) * 100 : 0;
                  return (
                    <li key={d.name} className="flex items-center gap-3 text-xs">
                      <span className="w-40 truncate font-medium" title={d.name}>
                        @{d.name}
                      </span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pctVal}%` }} />
                      </div>
                      <span className="w-12 text-right text-muted-foreground tabular-nums">{d.count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
