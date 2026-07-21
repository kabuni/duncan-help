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
    const completionPct = active.length ? Math.round((done / active.length) * 100) : 0;

    // Overall progress = average progress_percent across active items.
    // Items with NULL progress (unknown) are treated as 0 so they visibly drag the average down
    // until an admin enters a real value — we never fabricate partial progress.
    const progressSum = active.reduce((sum, i) => sum + (i.progress_percent ?? 0), 0);
    const progressPct = active.length ? Math.round(progressSum / active.length) : 0;
    const unknownProgress = active.filter((i) => i.progress_percent === null && i.status === "In Progress").length;

    return { total: active.length, done, inProg, not, overdue, critical, completionPct, progressPct, unknownProgress };
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between mb-1.5 text-xs">
            <span className="text-muted-foreground">
              Overall 90-Day Progress{" "}
              <span className="text-[10px]">(avg. progress % across active deliverables)</span>
            </span>
            <span className="font-semibold">{stats.progressPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${stats.progressPct}%` }} />
          </div>
          {stats.unknownProgress > 0 && (
            <div className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              {stats.unknownProgress} in-progress item{stats.unknownProgress === 1 ? "" : "s"} without a progress % — average treats them as 0.
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between mb-1.5 text-xs">
            <span className="text-muted-foreground">Completion <span className="text-[10px]">(Completed / Total)</span></span>
            <span className="font-semibold">{stats.completionPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${stats.completionPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
