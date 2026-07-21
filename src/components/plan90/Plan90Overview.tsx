import { useMemo } from "react";
import type { Plan90Deliverable } from "@/hooks/usePlan90";

interface Props { items: Plan90Deliverable[] }

export function Plan90Overview({ items }: Props) {
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const active = items.filter((i) => !i.archived);
    const done = active.filter((i) => i.status === "Completed").length;
    const inProg = active.filter((i) => i.status === "In Progress").length;
    const not = active.filter((i) => i.status === "Not Started").length;
    const overdue = active.filter((i) => i.due_date && new Date(i.due_date) < today && i.status !== "Completed").length;
    const critical = active.filter((i) => i.priority === "Critical" && i.status !== "Completed").length;
    const pct = active.length ? Math.round((done / active.length) * 100) : 0;
    return { total: active.length, done, inProg, not, overdue, critical, pct };
  }, [items]);

  const tiles = [
    { label: "Total", value: stats.total },
    { label: "Completed", value: stats.done, cls: "text-emerald-500" },
    { label: "In Progress", value: stats.inProg, cls: "text-amber-500" },
    { label: "Not Started", value: stats.not, cls: "text-muted-foreground" },
    { label: "Overdue", value: stats.overdue, cls: "text-red-500" },
    { label: "Critical", value: stats.critical, cls: "text-orange-500" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.label}</div>
            <div className={`text-2xl font-semibold ${t.cls || "text-foreground"}`}>{t.value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-muted-foreground">Overall 90-day progress</span>
          <span className="font-semibold">{stats.pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${stats.pct}%` }} />
        </div>
      </div>
    </div>
  );
}
