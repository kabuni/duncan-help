import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";

type Row = { created_at: string };

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Monday as start
  x.setDate(x.getDate() - day);
  return x;
}
function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function RegistrationsSummaryCards({ rows }: { rows: Row[] }) {
  const stats = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    let week = 0;
    let month = 0;
    for (const r of rows) {
      const t = new Date(r.created_at);
      if (t >= weekStart) week++;
      if (t >= monthStart) month++;
    }
    return { total: rows.length, week, month };
  }, [rows]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      <Tile label="Total Registrations" value={stats.total} sub="All-time" />
      <Tile label="This Week" value={stats.week} sub="Since Monday" />
      <Tile label="This Month" value={stats.month} sub="Calendar month to date" />
    </div>
  );
}
