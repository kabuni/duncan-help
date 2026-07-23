import { useMemo } from "react";
import type { Plan90Deliverable } from "@/hooks/usePlan90";
import type { Plan90Update } from "@/hooks/usePlan90Updates";
import type { Plan90FilterState } from "@/components/plan90/Plan90Filters";
import { cn } from "@/lib/utils";

interface Props {
  items: Plan90Deliverable[];
  latestByDeliverable?: Map<string, Plan90Update>;
  filters?: Plan90FilterState;
  onFiltersChange?: (patch: Partial<Plan90FilterState>) => void;
  onResetFilters?: () => void;
}

type TileKey = "total" | "completed" | "in_progress" | "not_started" | "overdue" | "critical";

export function Plan90Overview({ items, latestByDeliverable, filters, onFiltersChange, onResetFilters }: Props) {
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

  const activeTile: TileKey | null = useMemo(() => {
    if (!filters) return null;
    if (filters.status === "Completed") return "completed";
    if (filters.status === "In Progress") return "in_progress";
    if (filters.status === "Not Started") return "not_started";
    if (filters.timeframe === "overdue") return "overdue";
    if (filters.priority === "Critical") return "critical";
    return null;
  }, [filters]);

  const tiles: { key: TileKey; label: string; value: number; cls?: string; activeCls?: string }[] = [
    { key: "total", label: "Total", value: stats.total },
    { key: "completed", label: "Completed", value: stats.done, cls: "text-emerald-500", activeCls: "border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30" },
    { key: "in_progress", label: "In Progress", value: stats.inProg, cls: "text-amber-500", activeCls: "border-amber-500/60 bg-amber-500/5 ring-1 ring-amber-500/30" },
    { key: "not_started", label: "Not Started", value: stats.not, cls: "text-muted-foreground", activeCls: "border-foreground/40 bg-secondary ring-1 ring-foreground/20" },
    { key: "overdue", label: "Overdue", value: stats.overdue, cls: "text-red-500", activeCls: "border-red-500/60 bg-red-500/5 ring-1 ring-red-500/30" },
    { key: "critical", label: "Critical", value: stats.critical, cls: "text-orange-500", activeCls: "border-orange-500/60 bg-orange-500/5 ring-1 ring-orange-500/30" },
  ];

  const totalReported = stats.green + stats.amber + stats.red;
  const showHealth = !!latestByDeliverable && stats.total > 0;
  const interactive = !!onFiltersChange;

  const handleTileClick = (key: TileKey) => {
    if (!onFiltersChange) return;
    const isActive = activeTile === key;
    if (key === "total") {
      onResetFilters?.();
      return;
    }
    if (key === "completed") return onFiltersChange({ status: isActive ? "all" : "Completed" });
    if (key === "in_progress") return onFiltersChange({ status: isActive ? "all" : "In Progress" });
    if (key === "not_started") return onFiltersChange({ status: isActive ? "all" : "Not Started" });
    if (key === "overdue") return onFiltersChange({ timeframe: isActive ? "all" : "overdue" });
    if (key === "critical") return onFiltersChange({ priority: isActive ? "all" : "Critical" });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {tiles.map((t) => {
          const isActive = activeTile === t.key;
          const clickable = interactive && (t.key !== "total" || (filters && (filters.status !== "all" || filters.priority !== "all" || filters.timeframe !== "all" || filters.owner !== "all" || filters.workstream !== "all" || filters.q)));
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTileClick(t.key)}
              disabled={!clickable}
              aria-pressed={isActive}
              title={
                !interactive
                  ? undefined
                  : t.key === "total"
                    ? "Clear all filters"
                    : isActive
                      ? `Clear ${t.label} filter`
                      : `Filter by ${t.label}`
              }
              className={cn(
                "text-left rounded-lg border border-border bg-card px-3 py-2 transition-all",
                clickable && "cursor-pointer hover:border-foreground/30 hover:bg-secondary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !clickable && "cursor-default opacity-90",
                isActive && t.activeCls,
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.label}</div>
              <div className={`text-2xl font-semibold ${t.cls || "text-foreground"}`}>{t.value}</div>
            </button>
          );
        })}
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
