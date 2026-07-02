import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { School as SchoolIcon, MapPin, CalendarCheck2, Users, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { canAccessSchoolTracker } from "@/lib/schoolTrackerAccess";
import { MEETINGS, type Meeting } from "@/data/meetings";

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon?: any }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Bar({ label, count, max, tint }: { label: string; count: number; max: number; tint: string }) {
  const pct = max ? (count / max) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{count}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700", tint)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const REGION_TINT: Record<string, string> = {
  North: "bg-sky-500",
  South: "bg-emerald-500",
  East: "bg-amber-500",
  West: "bg-violet-500",
  Central: "bg-rose-500",
};

function numeric(n: Meeting["num_schools"]): number {
  return typeof n === "number" ? n : 0;
}

function formatDate(m: Meeting) {
  if (m.date) {
    try {
      return new Date(m.date + "T00:00:00").toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return m.date;
    }
  }
  return m.date_raw ?? "—";
}

export default function SchoolTracker() {
  const { user } = useAuth();
  if (!canAccessSchoolTracker(user?.id)) return <Navigate to="/" replace />;

  const [q, setQ] = useState("");
  const [region, setRegion] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [month, setMonth] = useState<string>("all");

  const regions = useMemo(() => Array.from(new Set(MEETINGS.map((m) => m.region).filter(Boolean))), []);
  const months = useMemo(() => Array.from(new Set(MEETINGS.map((m) => m.sheet))), []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return MEETINGS.filter((m) => {
      if (region !== "all" && m.region !== region) return false;
      if (status !== "all" && m.confirmed !== status) return false;
      if (month !== "all" && m.sheet !== month) return false;
      if (!term) return true;
      return [m.name, m.school, m.location, m.note].some((v) => (v || "").toLowerCase().includes(term));
    });
  }, [q, region, status, month]);

  const totals = useMemo(() => {
    const confirmed = filtered.filter((m) => m.confirmed === "Confirmed").length;
    const tentative = filtered.filter((m) => m.confirmed === "Tentative").length;
    const reach = filtered.reduce((s, m) => s + numeric(m.num_schools), 0);
    const locations = new Set(filtered.map((m) => m.location).filter(Boolean)).size;
    return { total: filtered.length, confirmed, tentative, reach, locations };
  }, [filtered]);

  const byRegion = useMemo(() => {
    const map = new Map<string, { meetings: number; reach: number }>();
    filtered.forEach((m) => {
      const r = m.region || "—";
      const cur = map.get(r) || { meetings: 0, reach: 0 };
      cur.meetings += 1;
      cur.reach += numeric(m.num_schools);
      map.set(r, cur);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].meetings - a[1].meetings);
  }, [filtered]);

  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((m) => map.set(m.sheet, (map.get(m.sheet) || 0) + 1));
    return Array.from(map.entries());
  }, [filtered]);

  const topProspects = useMemo(
    () =>
      [...filtered]
        .filter((m) => typeof m.num_schools === "number" && (m.num_schools as number) > 0)
        .sort((a, b) => numeric(b.num_schools) - numeric(a.num_schools))
        .slice(0, 8),
    [filtered],
  );

  const maxRegion = Math.max(1, ...byRegion.map(([, v]) => v.meetings));
  const maxMonth = Math.max(1, ...byMonth.map(([, v]) => v));

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <SchoolIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">School Registrations</h1>
          <p className="text-xs text-muted-foreground">
            Kabuni outreach meetings dashboard · {MEETINGS.length} appointments tracked
          </p>
        </div>
      </header>

      {/* Summary */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Total Meetings" value={String(totals.total)} icon={CalendarCheck2} />
        <Stat label="Confirmed" value={String(totals.confirmed)} sub="Appointments locked" />
        <Stat label="Tentative" value={String(totals.tentative)} sub="Awaiting confirmation" />
        <Stat label="Potential Schools" value={totals.reach.toLocaleString()} icon={Users} sub="Sum of numeric reach" />
        <Stat label="Locations" value={String(totals.locations)} icon={MapPin} />
      </section>

      {/* Breakdown */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Meetings by Region</div>
            {byRegion.length === 0 ? (
              <div className="text-xs text-muted-foreground">No data</div>
            ) : (
              byRegion.map(([r, v]) => (
                <Bar key={r} label={`${r} · ${v.reach.toLocaleString()} potential schools`} count={v.meetings} max={maxRegion} tint={REGION_TINT[r] ?? "bg-primary"} />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Meetings by Month</div>
            {byMonth.map(([m, v]) => (
              <Bar key={m} label={m} count={v} max={maxMonth} tint="bg-primary" />
            ))}
            <div className="pt-4 border-t border-border/60 space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Top Prospects (by reach)</div>
              {topProspects.length === 0 ? (
                <div className="text-xs text-muted-foreground">No numeric reach in current filter</div>
              ) : (
                <ul className="space-y-1.5">
                  {topProspects.map((m, i) => (
                    <li key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate mr-2">
                        <span className="font-medium">{m.school}</span>{" "}
                        <span className="text-muted-foreground">· {m.name}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">{numeric(m.num_schools).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search school, contact, location…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="Confirmed">Confirmed</SelectItem>
            <SelectItem value="Tentative">Tentative</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Showing {filtered.length} of {MEETINGS.length}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No meetings match these filters.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Contact</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead className="w-32">Location</TableHead>
                  <TableHead className="w-24">Region</TableHead>
                  <TableHead className="w-36">Date</TableHead>
                  <TableHead className="w-20">Time</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-20 text-right">Schools</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm font-medium">{m.name}</TableCell>
                    <TableCell className="text-sm">{m.school}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.location}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px]", REGION_TINT[m.region] && `${REGION_TINT[m.region]}/15 border-transparent`)}>
                        {m.region || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{formatDate(m)}</div>
                      {m.day && <div className="text-[10px] text-muted-foreground">{m.day}</div>}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{m.time || "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-medium",
                          m.confirmed === "Confirmed"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
                        )}
                      >
                        {m.confirmed}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {m.num_schools ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[320px]">
                      <div className="line-clamp-2">{m.note || "—"}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
