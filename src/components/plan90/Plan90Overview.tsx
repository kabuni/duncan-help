import { useMemo } from "react";
import type { Plan90Deliverable } from "@/hooks/usePlan90";
import type { Plan90Update } from "@/hooks/usePlan90Updates";
import { cn } from "@/lib/utils";

interface Props {
  items: Plan90Deliverable[];
  latestByDeliverable?: Map<string, Plan90Update>;
}

export function Plan90Overview({ items, latestByDeliverable }: Props) {
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const active = items.filter((i) => !i.archived);
    const done = active.filter((i) => i.status === "Completed").length;
    const inProg = active.filter((i) => i.status === "In Progress").length;
    const not = active.filter((i) => i.status === "Not Started").length;
    const overdue = active.filter((i) => i.due_date && new Date(i.due_date) < today && i.status !== "Completed").length;
    const critical = active.filter((i) => i.priority === "Critical" && i.status !== "Completed").length;
    const completionPct = active.length ? Math.round((done / active.length) * 100) : 0;

    let green = 0, amber = 0, red = 0, noUpdate = 0;
    if (latestByDeliverable) {
      for (const i of active) {
        const u = latestByDeliverable.get(i.id);
        if (!u) noUpdate++;
        else if (u.ryg === "green") green++;
        else if (u.ryg === "amber") amber++;
        else if (u.ryg === "red") red++;
      }
    }

    return { total: active.length, done, inProg, not, overdue, critical, completionPct, green, amber, red, noUpdate };
  }, [items, latestByDeliverable]);

  const tiles = [
    { label: "Total", value: stats.total },
    { label: "Completed", value: stats.done, cls: "text-emerald-500" },
    { label: "In Progress", value: stats.inProg, cls: "text-amber-500" },
    { label: "Not Started", value: stats.not, cls: "text-muted-foreground" },
    { label: "Overdue", value: stats.overdue, cls: "text-red-500" },
    { label: "Critical", value: stats.critical, cls: "text-orange-500" },
  ];

  const totalReported = stats.green + stats.amber + stats.red;
  const showHealth = !!latestByDeliverable && stats.total > 0;

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
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between mb-1.5 text-xs">
            <span className="text-muted-foreground">Completion <span className="text-[10px]">(Completed / Total active)</span></span>
            <span className="font-semibold">{stats.completionPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${stats.completionPct}%` }} />
          </div>
        </div>
        {showHealth && (
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between mb-1.5 text-xs">
              <span className="text-muted-foreground">Health <span className="text-[10px]">(latest update RYG)</span></span>
              <span className="text-[11px] text-muted-foreground">
                {totalReported}/{stats.total} reported
                {stats.noUpdate > 0 && <span className="ml-1">· {stats.noUpdate} no update</span>}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden flex">
              {stats.green > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(stats.green / stats.total) * 100}%` }} />}
              {stats.amber > 0 && <div className="h-full bg-amber-500" style={{ width: `${(stats.amber / stats.total) * 100}%` }} />}
              {stats.red > 0 && <div className="h-full bg-red-500" style={{ width: `${(stats.red / stats.total) * 100}%` }} />}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px]">
              <RygLegend color="bg-emerald-500" label="Green" value={stats.green} />
              <RygLegend color="bg-amber-500" label="Amber" value={stats.amber} />
              <RygLegend color="bg-red-500" label="Red" value={stats.red} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RygLegend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {label} <span className="text-foreground font-medium">{value}</span>
    </span>
  );
}
