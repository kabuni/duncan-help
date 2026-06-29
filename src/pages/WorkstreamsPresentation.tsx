import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Target, ArrowLeft, Printer, CheckCircle2, AlertTriangle, Clock,
  TrendingUp, Users, CalendarDays,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip as RTooltip, Legend,
} from "recharts";
import { isPast, format, differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useWorkstreamCards, type WorkstreamCard, type CardStatus } from "@/hooks/useWorkstreams";

const STATUS_COLORS: Record<string, string> = {
  red: "hsl(0 84% 60%)",
  yellow: "hsl(38 92% 50%)",
  amber: "hsl(38 92% 50%)",
  green: "hsl(142 71% 45%)",
  done: "hsl(var(--primary))",
  not_started: "hsl(var(--muted-foreground))",
};

const normalize = (s: string) => (s === "amber" ? "yellow" : s);

export default function WorkstreamsPresentation() {
  const { data: cards, isLoading } = useWorkstreamCards();

  const stats = useMemo(() => {
    const c = cards || [];
    const taskTotals = { red: 0, yellow: 0, green: 0, done: 0, not_started: 0 };
    const cardCounts = { red: 0, yellow: 0, green: 0, done: 0, not_started: 0 };
    let totalTasks = 0;
    const ownerAgg: Record<string, { name: string; total: number; done: number }> = {};
    const tagAgg: Record<string, { total: number; done: number; red: number; yellow: number; green: number }> = {};

    for (const card of c) {
      const tb = card.task_breakdown || { red: 0, yellow: 0, green: 0, done: 0, not_started: 0 };
      taskTotals.red += tb.red;
      taskTotals.yellow += tb.yellow;
      taskTotals.green += tb.green;
      taskTotals.done += tb.done;
      taskTotals.not_started += (tb as any).not_started || 0;
      totalTasks += tb.red + tb.yellow + tb.green + tb.done + ((tb as any).not_started || 0);

      const cs = normalize(card.status as string);
      if (cs in cardCounts) (cardCounts as any)[cs]++;

      // owner aggregation across assignees
      const owners = (card.assignees && card.assignees.length > 0)
        ? card.assignees.map(a => ({ id: a.user_id, name: a.display_name || "Unknown" }))
        : card.owner_name ? [{ id: card.owner_id || "x", name: card.owner_name }] : [];
      for (const o of owners) {
        ownerAgg[o.id] ||= { name: o.name, total: 0, done: 0 };
        ownerAgg[o.id].total += (card.tasks_total || 0);
        ownerAgg[o.id].done += (card.tasks_completed || 0);
      }

      const tag = card.project_tag || "Untagged";
      tagAgg[tag] ||= { total: 0, done: 0, red: 0, yellow: 0, green: 0 };
      tagAgg[tag].total += card.tasks_total || 0;
      tagAgg[tag].done += card.tasks_completed || 0;
      tagAgg[tag].red += tb.red;
      tagAgg[tag].yellow += tb.yellow;
      tagAgg[tag].green += tb.green;
    }

    const totalCards = c.length;
    const completionPct = totalTasks > 0 ? Math.round((taskTotals.done / totalTasks) * 100) : 0;

    const today = new Date();
    const overdue = c.filter(card =>
      card.due_date && isPast(new Date(card.due_date)) && normalize(card.status as string) !== "done"
    );
    const dueSoon = c.filter(card => {
      if (!card.due_date) return false;
      const d = new Date(card.due_date);
      const days = differenceInDays(d, today);
      return days >= 0 && days <= 7 && normalize(card.status as string) !== "done";
    });

    const atRisk = [...c]
      .filter(card => {
        const cs = normalize(card.status as string);
        return cs === "red" || cs === "yellow" || (card.task_breakdown?.red ?? 0) > 0;
      })
      .sort((a, b) => (b.task_breakdown?.red ?? 0) - (a.task_breakdown?.red ?? 0))
      .slice(0, 6);

    const topProgress = [...c]
      .filter(card => (card.tasks_total ?? 0) > 0)
      .sort((a, b) => {
        const pa = (a.tasks_completed! / a.tasks_total!);
        const pb = (b.tasks_completed! / b.tasks_total!);
        return pb - pa;
      })
      .slice(0, 6);

    const owners = Object.values(ownerAgg)
      .filter(o => o.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const tags = Object.entries(tagAgg)
      .map(([name, v]) => ({ name, ...v, pct: v.total ? Math.round((v.done / v.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    return {
      totalCards, totalTasks, completionPct, taskTotals, cardCounts,
      overdue, dueSoon, atRisk, topProgress, owners, tags,
    };
  }, [cards]);

  if (isLoading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading presentation…</div>
      </main>
    );
  }

  const statusPie = [
    { name: "Done", value: stats.taskTotals.done, color: STATUS_COLORS.done },
    { name: "Green", value: stats.taskTotals.green, color: STATUS_COLORS.green },
    { name: "Yellow", value: stats.taskTotals.yellow, color: STATUS_COLORS.yellow },
    { name: "Red", value: stats.taskTotals.red, color: STATUS_COLORS.red },
    { name: "Not started", value: stats.taskTotals.not_started, color: STATUS_COLORS.not_started },
  ].filter(s => s.value > 0);

  const cardStatusBar = [
    { name: "Red", value: stats.cardCounts.red, fill: STATUS_COLORS.red },
    { name: "Yellow", value: stats.cardCounts.yellow, fill: STATUS_COLORS.yellow },
    { name: "Green", value: stats.cardCounts.green, fill: STATUS_COLORS.green },
    { name: "Done", value: stats.cardCounts.done, fill: STATUS_COLORS.done },
    { name: "Not started", value: stats.cardCounts.not_started, fill: STATUS_COLORS.not_started },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-background print:bg-white">
      <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0 print:hidden" />

      <div className="relative z-10 px-4 sm:px-10 py-6 sm:py-10 max-w-[1400px] mx-auto">
        {/* Header / controls */}
        <div className="flex items-center justify-between mb-8 print:hidden">
          <Link to="/workstreams" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Workstreams
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
            <Target className="h-4 w-4" /> Workstreams · Progress Briefing
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground mb-2">
            Company-wide Tasks & Progress
          </h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), "EEEE, d MMMM yyyy")} · Live snapshot across {stats.totalCards} workstreams
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <Kpi label="Workstreams" value={stats.totalCards} />
            <Kpi label="Total Tasks" value={stats.totalTasks} />
            <Kpi label="Completion" value={`${stats.completionPct}%`} accent />
            <Kpi label="Overdue" value={stats.overdue.length} danger={stats.overdue.length > 0} />
          </div>

          {/* Hero progress bar */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-mono uppercase tracking-wider text-muted-foreground">Overall Completion</span>
              <span className="font-mono text-foreground">{stats.taskTotals.done} / {stats.totalTasks} tasks done</span>
            </div>
            <Progress value={stats.completionPct} className="h-3" />
          </div>
        </motion.section>

        {/* RYG breakdown */}
        <Slide title="Status Health — RYG Breakdown" subtitle="How tasks and workstreams distribute across the RYG framework">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">Tasks by status</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                      {statusPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <RTooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">Workstreams by status</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cardStatusBar} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {cardStatusBar.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </Slide>

        {/* At risk */}
        <Slide title="🔴 At-Risk Workstreams" subtitle="Cards flagged red/yellow or with red tasks — needs leadership attention">
          {stats.atRisk.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />} text="Nothing at risk — everything is on track." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {stats.atRisk.map(card => <RiskCard key={card.id} card={card} />)}
            </div>
          )}
        </Slide>

        {/* Top progress */}
        <Slide title="🚀 Top Progress" subtitle="Workstreams furthest along by task completion">
          {stats.topProgress.length === 0 ? (
            <EmptyState icon={<TrendingUp className="h-6 w-6 text-muted-foreground" />} text="No tasks yet to track progress." />
          ) : (
            <div className="space-y-2">
              {stats.topProgress.map(card => {
                const pct = Math.round((card.tasks_completed! / card.tasks_total!) * 100);
                return (
                  <div key={card.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center justify-between mb-2 gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{card.title}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{card.project_tag || "Untagged"} · {card.tasks_completed}/{card.tasks_total} tasks</div>
                      </div>
                      <span className="text-lg font-bold text-primary tabular-nums">{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                );
              })}
            </div>
          )}
        </Slide>

        {/* Deadlines */}
        <Slide title="📅 Deadlines" subtitle="Overdue and upcoming this week">
          <div className="grid md:grid-cols-2 gap-6">
            <DeadlineColumn
              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              title="Overdue"
              cards={stats.overdue}
              tone="red"
              empty="No overdue workstreams."
            />
            <DeadlineColumn
              icon={<Clock className="h-4 w-4 text-amber-500" />}
              title="Due this week"
              cards={stats.dueSoon}
              tone="amber"
              empty="Nothing due in the next 7 days."
            />
          </div>
        </Slide>

        {/* Owners */}
        <Slide title="👥 Workload by Owner" subtitle="Task volume and completion across the team">
          {stats.owners.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6 text-muted-foreground" />} text="No owners assigned yet." />
          ) : (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.owners.map(o => ({ name: o.name.split(" ")[0], Done: o.done, Open: Math.max(0, o.total - o.done) }))} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Done" stackId="a" fill={STATUS_COLORS.done} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Open" stackId="a" fill={STATUS_COLORS.yellow} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </Slide>

        {/* By tag */}
        {stats.tags.length > 0 && (
          <Slide title="🏷️ Progress by Project Tag" subtitle="Where each initiative stands">
            <div className="grid sm:grid-cols-2 gap-3">
              {stats.tags.map(t => (
                <div key={t.name} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-foreground truncate">{t.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{t.done}/{t.total}</span>
                  </div>
                  <Progress value={t.pct} className="h-2 mb-2" />
                  <div className="flex items-center gap-3 text-[10px] font-mono">
                    {t.red > 0 && <span className="text-red-500">● {t.red} red</span>}
                    {t.yellow > 0 && <span className="text-amber-500">● {t.yellow} yellow</span>}
                    {t.green > 0 && <span className="text-emerald-500">● {t.green} green</span>}
                  </div>
                </div>
              ))}
            </div>
          </Slide>
        )}

        <div className="text-center text-[10px] font-mono text-muted-foreground/60 mt-12 print:mt-6">
          Generated by Duncan · {format(new Date(), "PPpp")}
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          .print\\:break-after-page { break-after: page; }
        }
      `}</style>
    </main>
  );
}

function Kpi({ label, value, accent, danger }: { label: string; value: string | number; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-5 py-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-3xl font-bold tracking-tight tabular-nums ${
        danger ? "text-red-500" : accent ? "text-primary" : "text-foreground"
      }`}>{value}</p>
    </div>
  );
}

function Slide({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4 }}
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

function RiskCard({ card }: { card: WorkstreamCard }) {
  const cs = normalize(card.status as string);
  const borderClr = cs === "red" ? "border-l-red-500" : cs === "yellow" ? "border-l-amber-500" : "border-l-muted-foreground/40";
  const tb = card.task_breakdown;
  return (
    <div className={`rounded-lg border border-l-[4px] ${borderClr} bg-card p-4`}>
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="text-sm font-semibold text-foreground truncate">{card.title}</span>
        {card.project_tag && (
          <span className="shrink-0 text-[9px] font-mono bg-secondary/80 text-muted-foreground px-1.5 py-0.5 rounded">{card.project_tag}</span>
        )}
      </div>
      {card.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2">{card.description}</p>
      )}
      <div className="flex items-center gap-3 text-[10px] font-mono">
        {tb && tb.red > 0 && <span className="text-red-500">● {tb.red} red</span>}
        {tb && tb.yellow > 0 && <span className="text-amber-500">● {tb.yellow} yellow</span>}
        {tb && tb.green > 0 && <span className="text-emerald-500">● {tb.green} green</span>}
        {tb && tb.done > 0 && <span className="text-primary">● {tb.done} done</span>}
        {card.due_date && (
          <span className={`ml-auto flex items-center gap-1 ${isPast(new Date(card.due_date)) ? "text-red-500" : "text-muted-foreground"}`}>
            <CalendarDays className="h-3 w-3" />{format(new Date(card.due_date), "MMM d")}
          </span>
        )}
      </div>
    </div>
  );
}

function DeadlineColumn({ icon, title, cards, tone, empty }: {
  icon: React.ReactNode; title: string; cards: WorkstreamCard[]; tone: "red" | "amber"; empty: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">{cards.length}</span>
      </div>
      {cards.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{empty}</p>
      ) : (
        <div className="space-y-2">
          {cards.slice(0, 6).map(card => (
            <div key={card.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{card.title}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{card.project_tag || "Untagged"}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-mono ${tone === "red" ? "text-red-500" : "text-amber-500"}`}>
                {card.due_date && format(new Date(card.due_date), "MMM d")}
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
