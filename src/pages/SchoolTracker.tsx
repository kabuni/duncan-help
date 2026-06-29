import { useEffect, useMemo, useState } from "react";
import { useSchoolTracker, type SchoolTrackerRow, type SchoolTrackerStatus } from "@/hooks/useSchoolTracker";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown, CalendarPlus, Plus, School as SchoolIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import AddSchoolDialog from "@/components/school-tracker/AddSchoolDialog";

function buildCalendarUrl(row: SchoolTrackerRow) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Kabuni intro — ${row.name}`,
    details: [
      `School: ${row.name}`,
      `Region: ${row.region}`,
      `Status: ${row.status}`,
      row.contact_name ? `Contact: ${row.contact_name}` : "",
      `Students: ${row.student_count}`,
    ].filter(Boolean).join("\n"),
    location: row.region,
  });
  if (row.contact_email) params.set("add", row.contact_email);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const STATUS_META: Record<SchoolTrackerStatus, { label: string; badge: string; bar: string }> = {
  registered: {
    label: "Registered",
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    bar: "bg-emerald-500",
  },
  confirmed: {
    label: "Confirmed",
    badge: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    bar: "bg-sky-500",
  },
  pending: {
    label: "Pending",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    bar: "bg-amber-500",
  },
  declined: {
    label: "Declined",
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    bar: "bg-destructive",
  },
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
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

function ArcGauge({ pct }: { pct: number }) {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(pct), 50);
    return () => clearTimeout(t);
  }, [pct]);

  // Half-circle arc from 180° to 360°
  const radius = 90;
  const cx = 110;
  const cy = 110;
  const circumference = Math.PI * radius; // half circle
  const offset = circumference - (animated / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="220" height="140" viewBox="0 0 220 140">
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1200ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
        <text
          x={cx}
          y={cy - 5}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 32, fontWeight: 600 }}
        >
          {Math.round(animated)}%
        </text>
        <text
          x={cx}
          y={cy + 18}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}
        >
          Engaged
        </text>
      </svg>
    </div>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(value), 50);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-1000 ease-out", className ?? "bg-primary")}
        style={{ width: `${Math.max(0, Math.min(100, w))}%` }}
      />
    </div>
  );
}

export default function SchoolTracker() {
  const { data: rows = [], isLoading } = useSchoolTracker();
  const [statusFilter, setStatusFilter] = useState<SchoolTrackerStatus | "all">("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [addOpen, setAddOpen] = useState(false);

  const counts = useMemo(() => {
    const c = { registered: 0, confirmed: 0, pending: 0, declined: 0 };
    rows.forEach((r) => {
      c[r.status] = (c[r.status] ?? 0) + 1;
    });
    return c;
  }, [rows]);

  const total = rows.length;
  const engaged = counts.registered + counts.confirmed;
  const overallPct = total > 0 ? Math.round((engaged / total) * 100) : 0;

  const filtered = useMemo(() => {
    let list = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);
    const order: Record<SchoolTrackerStatus, number> = {
      registered: 1,
      confirmed: 2,
      pending: 3,
      declined: 4,
    };
    list = [...list].sort((a, b) =>
      sortDir === "asc" ? order[a.status] - order[b.status] : order[b.status] - order[a.status]
    );
    return list;
  }, [rows, statusFilter, sortDir]);

  const maxCount = Math.max(counts.registered, counts.confirmed, counts.pending, counts.declined, 1);

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <SchoolIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">School Registrations</h1>
          <p className="text-xs text-muted-foreground">Kabuni school outreach pipeline — live tracker</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add school
        </Button>
      </header>

      {/* Summary stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Total Targeted" value={String(total)} />
        <Stat label="Registered" value={String(counts.registered)} />
        <Stat label="Confirmed" value={String(counts.confirmed)} />
        <Stat label="Pending" value={String(counts.pending)} />
        <Stat label="Overall Progress" value={`${overallPct}%`} sub="Registered + Confirmed" />
      </section>

      {/* Arc + pipeline */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Overall Progress</div>
            <ArcGauge pct={overallPct} />
            <div className="text-[11px] text-muted-foreground mt-1">
              {engaged} of {total} schools engaged
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pipeline Breakdown</div>
            {(["registered", "confirmed", "pending", "declined"] as SchoolTrackerStatus[]).map((s) => {
              const count = counts[s];
              const pct = (count / maxCount) * 100;
              return (
                <div key={s} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{STATUS_META[s].label}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <ProgressBar value={pct} className={STATUS_META[s].bar} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Filter status:</span>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SchoolTrackerStatus | "all")}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="registered">Registered</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted transition-colors"
        >
          <ArrowUpDown className="h-3 w-3" />
          Sort by status ({sortDir})
        </button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading schools…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? (
                <div className="space-y-3">
                  <div>No schools yet — start by adding one.</div>
                  <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
                    <Plus className="h-4 w-4" /> Add school
                  </Button>
                </div>
              ) : (
                "No schools match this filter."
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-[260px]">Progress</TableHead>
                  <TableHead className="w-24 text-right">Students</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <SchoolRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddSchoolDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function SchoolRow({ row }: { row: SchoolTrackerRow }) {
  const meta = STATUS_META[row.status];
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-sm">{row.name}</div>
        <div className="text-xs text-muted-foreground">{row.region}</div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn("font-medium", meta.badge)}>
          {meta.label}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <ProgressBar value={row.progress_pct} className={meta.bar} />
          <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{row.progress_pct}%</span>
        </div>
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">{row.student_count.toLocaleString()}</TableCell>
      <TableCell className="text-right">
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
        >
          <a
            href={buildCalendarUrl(row)}
            target="_blank"
            rel="noopener noreferrer"
            title={row.contact_email ? `Invite ${row.contact_email}` : "Schedule a meeting"}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Schedule
          </a>
        </Button>
      </TableCell>
    </TableRow>
  );
}
