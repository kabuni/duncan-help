import { useEffect, useMemo, useState } from "react";
import { logSavings } from "@/lib/savings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";


import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Target, ArrowLeft, Printer, CheckCircle2, AlertTriangle, Clock, CalendarDays, ChevronRight } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, Legend } from "recharts";
import { format, isPast, differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { usePlan90, type Plan90Deliverable } from "@/hooks/usePlan90";
import { usePlan90Updates } from "@/hooks/usePlan90Updates";

const COLORS = {
  completed: "hsl(142 71% 45%)",
  inprogress: "hsl(38 92% 50%)",
  atrisk: "hsl(25 95% 53%)",
  blocked: "hsl(0 84% 60%)",
  stopped: "hsl(215 16% 47%)",
  notstarted: "hsl(var(--muted-foreground))",
  red: "hsl(0 84% 60%)",
  primary: "hsl(var(--primary))",
};

const PLAN90_STATUS_ORDER = ["At Risk", "Blocked", "In Progress", "Stopped", "Not Started", "Completed"] as const;

const STATUS_META: Record<string, { dot: string }> = {
  "In Progress": { dot: "bg-amber-500" },
  Completed: { dot: "bg-emerald-500" },
  "At Risk": { dot: "bg-orange-500" },
  Stopped: { dot: "bg-slate-500" },
  Blocked: { dot: "bg-red-500" },
  "Not Started": { dot: "bg-muted-foreground" },
};

export default function Plan90Presentation() {
  const { workstreams, deliverables, loading } = usePlan90();
  const { latestByDeliverable, items: allUpdates } = usePlan90Updates();
  const [selected, setSelected] = useState<Plan90Deliverable | null>(null);


  // Hours Saved: one event per presentation view (replaces manually building a deck).
  useEffect(() => {
    logSavings("ui.plan90.presentation");
  }, []);



  const stats = useMemo(() => {
    const items = deliverables.filter((d) => !d.archived);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const byStatus = { Completed: 0, "In Progress": 0, "At Risk": 0, Blocked: 0, Stopped: 0, "Not Started": 0 } as Record<string, number>;
    for (const d of items) byStatus[d.status] = (byStatus[d.status] || 0) + 1;

    const completionPct = items.length ? Math.round((byStatus["Completed"] / items.length) * 100) : 0;

    const overdue = items.filter((d) => d.due_date && new Date(d.due_date) < today && d.status !== "Completed");
    const dueSoon = items.filter((d) => {
      if (!d.due_date || d.status === "Completed") return false;
      const days = differenceInDays(new Date(d.due_date), today);
      return days >= 0 && days <= 7;
    });

    const wsRows = workstreams
      .filter((w) => !w.archived)
      .map((w) => {
        const list = items.filter((d) => d.workstream_id === w.id);
        const count = (s: string) => list.filter((d) => d.status === s).length;
        const done = count("Completed");
        return {
          id: w.id,
          name: w.name,
          total: list.length,
          done,
          inProg: count("In Progress"),
          notStarted: count("Not Started"),
          atRisk: count("At Risk"),
          stopped: count("Stopped"),
          blocked: count("Blocked"),
          pct: list.length ? Math.round((done / list.length) * 100) : 0,
          list,
        };
      })
      .filter((w) => w.total > 0)
      .sort((a, b) => b.total - a.total);


    const atRisk = items
      .filter((d) => {
        const ryg = latestByDeliverable.get(d.id)?.ryg;
        const isOverdue = !!d.due_date && new Date(d.due_date) < today && d.status !== "Completed";
        return ryg === "red" || ryg === "amber" || isOverdue;
      })
      .slice(0, 8);

    const recentUpdates = allUpdates.slice(0, 8);

    // Accountability: pending (not completed) deliverables per owner
    const ownerMap = new Map<string, { name: string; pending: number; overdue: number; atRisk: number; blocked: number; total: number }>();
    for (const d of items) {
      const name = d.owner_display_name?.trim() || "Unassigned";
      const row = ownerMap.get(name) || { name, pending: 0, overdue: 0, atRisk: 0, blocked: 0, total: 0 };
      row.total += 1;
      if (d.status !== "Completed") {
        row.pending += 1;
        if (d.due_date && new Date(d.due_date) < today) row.overdue += 1;
        if (d.status === "At Risk") row.atRisk += 1;
        if (d.status === "Blocked" || d.status === "Stopped") row.blocked += 1;
      }
      ownerMap.set(name, row);
    }
    const ownerRows = Array.from(ownerMap.values())
      .filter((o) => o.pending > 0)
      .sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));

    return { items, byStatus, completionPct, overdue, dueSoon, wsRows, atRisk, recentUpdates, ownerRows };
  }, [deliverables, workstreams, latestByDeliverable, allUpdates]);


  const updatesByDeliverable = useMemo(() => {
    const map = new Map<string, typeof allUpdates>();
    for (const u of allUpdates) {
      const list = map.get(u.deliverable_id) || [];
      list.push(u);
      map.set(u.deliverable_id, list);
    }
    return map;
  }, [allUpdates]);



  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading presentation…</div>
      </main>
    );
  }

  const wsName = (id: string) => workstreams.find((w) => w.id === id)?.name || "—";

  const statusPie = [
    { name: "Completed", value: stats.byStatus["Completed"] || 0, color: COLORS.completed },
    { name: "In Progress", value: stats.byStatus["In Progress"] || 0, color: COLORS.inprogress },
    { name: "At Risk", value: stats.byStatus["At Risk"] || 0, color: COLORS.atrisk },
    { name: "Blocked", value: stats.byStatus["Blocked"] || 0, color: COLORS.blocked },
    { name: "Stopped", value: stats.byStatus["Stopped"] || 0, color: COLORS.stopped },
    { name: "Not Started", value: stats.byStatus["Not Started"] || 0, color: COLORS.notstarted },
  ].filter((s) => s.value > 0);

  return (
    <main className="flex-1 overflow-y-auto bg-background print:bg-white">
      <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0 print:hidden" />

      <div className="relative z-10 px-4 sm:px-10 py-6 sm:py-10 max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <Link to="/plan-90" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to 90 Day Tracker
          </Link>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
            <Printer className="h-3.5 w-3.5" /> Print / Save PDF
          </Button>
        </div>

        {/* Title slide */}
        <motion.section
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card/60 backdrop-blur px-8 py-10 mb-8 print:break-after-page"
        >
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-primary mb-3">
            <Target className="h-4 w-4" /> 90 Day Plan · Progress Briefing
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground mb-2">
            90 Day Tracker — Status
          </h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), "EEEE, d MMMM yyyy")} · Live snapshot across {stats.wsRows.length} workstreams
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <Kpi label="Deliverables" value={stats.items.length} />
            <Kpi label="Completed" value={stats.byStatus["Completed"] || 0} />
            <Kpi label="Completion" value={`${stats.completionPct}%`} accent />
            <Kpi label="Overdue" value={stats.overdue.length} danger={stats.overdue.length > 0} />
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-mono uppercase tracking-wider text-muted-foreground">Overall Completion</span>
              <span className="font-mono text-foreground">{stats.byStatus["Completed"] || 0} / {stats.items.length} deliverables</span>
            </div>
            <Progress value={stats.completionPct} className="h-3" />
          </div>
        </motion.section>

        {/* Status breakdown */}
        <Slide title="Status Breakdown" subtitle="Deliverables by status and workstream volume">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">Deliverables by status</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                      {statusPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <RTooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">Progress by workstream</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stats.wsRows.slice(0, 8).map((w) => ({ name: w.name.length > 14 ? `${w.name.slice(0, 14)}…` : w.name, Done: w.done, Open: w.total - w.done }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  >
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-20} textAnchor="end" height={54} />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                    <RTooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Done" stackId="a" fill={COLORS.completed} />
                    <Bar dataKey="Open" stackId="a" fill={COLORS.inprogress} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </Slide>

        {/* Workstream detail */}
        <Slide title="📊 Workstream Scorecard" subtitle="Completion and health per workstream">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2">Workstream</th>
                  <th className="text-center px-3 py-2">Total</th>
                  <th className="text-center px-3 py-2">In progress</th>
                  <th className="text-center px-3 py-2">Completed</th>
                  <th className="text-center px-3 py-2">At risk</th>
                  <th className="text-center px-3 py-2">Stopped</th>
                  <th className="text-center px-3 py-2">Blocked</th>
                  <th className="text-center px-3 py-2">Not started</th>
                  <th className="text-left px-4 py-2 w-[200px]">Completion</th>
                </tr>
              </thead>
              <tbody>
                {stats.wsRows.map((w) => (
                  <tr key={w.id} className="border-t border-border/60">
                    <td className="px-4 py-2.5 font-medium text-foreground">{w.name}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{w.total}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-amber-500">{w.inProg || "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-emerald-500">{w.done || "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-orange-500">{w.atRisk || "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-500">{w.stopped || "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-red-500">{w.blocked || "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{w.notStarted || "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Progress value={w.pct} className="h-2 flex-1" />
                        <span className="text-xs font-mono tabular-nums w-9 text-right">{w.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}

              </tbody>
            </table>
          </div>
        </Slide>

        {/* Accountability */}
        <Slide title="🙋 Accountability" subtitle="Open (not completed) deliverables by owner">
          {stats.ownerRows.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-xs text-muted-foreground text-center">
              Nothing outstanding — every deliverable is completed.
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-4 py-2">Owner</th>
                    <th className="text-center px-3 py-2">Pending</th>
                    <th className="text-center px-3 py-2">Overdue</th>
                    <th className="text-center px-3 py-2">At risk</th>
                    <th className="text-center px-3 py-2">Blocked / stopped</th>
                    <th className="text-center px-3 py-2">Total owned</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.ownerRows.map((o) => (
                    <tr key={o.name} className="border-t border-border/60">
                      <td className="px-4 py-2.5 font-medium text-foreground">{o.name}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums font-semibold">{o.pending}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums text-red-500">{o.overdue || "—"}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums text-orange-500">{o.atRisk || "—"}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums text-slate-500">{o.blocked || "—"}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{o.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Slide>


        {/* Updates by status */}
        <Slide title="🗂 Updates by Status" subtitle="Expand a status to read the comments logged against its deliverables">
          <div className="space-y-3">
            {PLAN90_STATUS_ORDER.map((status) => {
              const items = stats.items.filter((d) => d.status === status);
              const rows = items.map((d) => ({ d, updates: updatesByDeliverable.get(d.id) || [] }));
              const commentCount = rows.reduce((n, r) => n + r.updates.length, 0);
              const meta = STATUS_META[status];
              return (
                <details key={status} className="group rounded-xl border border-border bg-card overflow-hidden print:open" open={status === "At Risk" || status === "Blocked"}>
                  <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none select-none hover:bg-secondary/40 transition-colors">
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                    <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                    <span className="text-sm font-semibold text-foreground">{status}</span>
                    <span className="text-[10px] font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">{items.length} deliverables</span>
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground">{commentCount} update{commentCount === 1 ? "" : "s"}</span>
                  </summary>
                  <div className="border-t border-border/60">
                    {rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-4 py-5 text-center">No deliverables in this status.</p>
                    ) : (
                      <div className="divide-y divide-border/60">
                        {rows.map(({ d, updates }) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setSelected(d)}
                            className="w-full text-left px-4 py-3 hover:bg-secondary/40 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="text-xs font-semibold text-foreground">{d.title}</span>
                              <span className="shrink-0 text-[9px] font-mono bg-secondary/80 text-muted-foreground px-1.5 py-0.5 rounded">{wsName(d.workstream_id)}</span>
                            </div>
                            <div className="text-[10px] font-mono text-muted-foreground mb-2">
                              {d.owner_display_name || "Unassigned"}
                              {d.due_date && ` · due ${format(new Date(d.due_date), "MMM d")}`}
                            </div>
                            {updates.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground italic">No updates logged.</p>
                            ) : (
                              <div className="space-y-2">
                                {updates.slice(0, 5).map((u) => {
                                  const dot = u.ryg === "red" ? "bg-red-500" : u.ryg === "amber" ? "bg-amber-500" : "bg-emerald-500";
                                  return (
                                    <div key={u.id} className="flex gap-2">
                                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                                      <div className="min-w-0">
                                        <p className="text-[11px] text-foreground/90 leading-6 whitespace-pre-wrap">{u.message}</p>
                                        <span className="text-[10px] font-mono text-muted-foreground">{u.author_name} · {format(new Date(u.created_at), "d MMM")}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </button>
                        ))}

                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </Slide>




        {/* Deadlines */}
        <Slide title="📅 Deadlines" subtitle="Overdue and due within 7 days">
          <div className="grid md:grid-cols-2 gap-6">
            <DeadlineColumn icon={<AlertTriangle className="h-4 w-4 text-red-500" />} title="Overdue" items={stats.overdue} tone="red" empty="No overdue deliverables." wsName={wsName} />
            <DeadlineColumn icon={<Clock className="h-4 w-4 text-amber-500" />} title="Due this week" items={stats.dueSoon} tone="amber" empty="Nothing due in the next 7 days." wsName={wsName} />
          </div>
        </Slide>

        {/* Latest updates */}
        <Slide title="📝 Latest Updates" subtitle="Most recent progress notes posted against deliverables">
          {stats.recentUpdates.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6 text-muted-foreground" />} text="No updates posted yet." />
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
              {stats.recentUpdates.map((u) => {
                const d = deliverables.find((x) => x.id === u.deliverable_id);
                const dot = u.ryg === "red" ? "bg-red-500" : u.ryg === "amber" ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <div key={u.id} className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      <span className="text-sm font-medium text-foreground">{d?.title || "Deliverable"}</span>
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                        {u.author_name} · {format(new Date(u.created_at), "d MMM")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-6 whitespace-pre-wrap">{u.message}</p>
                  </div>
                );
              })}
            </div>
          )}
        </Slide>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base leading-6 pr-6">{selected.title}</DialogTitle>
              </DialogHeader>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono text-[10px]">{wsName(selected.workstream_id)}</Badge>
                <Badge variant="outline" className="font-mono text-[10px]">{selected.status}</Badge>
                <Badge variant="outline" className="font-mono text-[10px]">{selected.priority}</Badge>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <DetailField label="Owner" value={selected.owner_display_name || "Unassigned"} />
                <DetailField label="Due date" value={selected.due_date ? format(new Date(selected.due_date), "d MMM yyyy") : "—"} />
                <DetailField label="Progress" value={`${selected.progress_percent ?? 0}%`} />
                <DetailField label="Last updated" value={format(new Date(selected.updated_at), "d MMM yyyy")} />
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Progress</div>
                <Progress value={selected.progress_percent ?? 0} className="h-2" />
              </div>

              {selected.notes && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
                  <p className="text-xs text-foreground/90 leading-6 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}

              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                  Updates ({(updatesByDeliverable.get(selected.id) || []).length})
                </div>
                {(updatesByDeliverable.get(selected.id) || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No updates logged yet.</p>
                ) : (
                  <div className="space-y-3">
                    {(updatesByDeliverable.get(selected.id) || []).map((u) => {
                      const dot = u.ryg === "red" ? "bg-red-500" : u.ryg === "amber" ? "bg-amber-500" : "bg-emerald-500";
                      return (
                        <div key={u.id} className="flex gap-2 border-b border-border/50 pb-2 last:border-0">
                          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                          <div className="min-w-0">
                            <p className="text-xs text-foreground/90 leading-6 whitespace-pre-wrap">{u.message}</p>
                            <span className="text-[10px] font-mono text-muted-foreground">{u.author_name} · {format(new Date(u.created_at), "d MMM yyyy")}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>

  );
}

function Kpi({ label, value, accent, danger }: { label: string; value: string | number; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${danger ? "text-red-500" : accent ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function Slide({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
      className="mb-10 print:break-after-page"
    >
      <div className="mb-4">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children}
    </motion.section>
  );
}

function DeadlineColumn({ icon, title, items, tone, empty, wsName }: {
  icon: React.ReactNode; title: string; items: Plan90Deliverable[]; tone: "red" | "amber"; empty: string; wsName: (id: string) => string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 8).map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{d.title}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{wsName(d.workstream_id)} · {d.owner_display_name || "Unassigned"}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-mono ${tone === "red" ? "text-red-500" : "text-amber-500"}`}>
                {d.due_date && format(new Date(d.due_date), "MMM d")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 flex flex-col items-center justify-center gap-2">
      {icon}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs text-foreground mt-0.5">{value}</div>
    </div>
  );
}
