import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Loader2 } from "lucide-react";
import { useProjectWorkstreams, useProjectTasks, RYG_META } from "@/hooks/useProjectWork";
import { taskCodeHref } from "@/components/TaskIdLink";
import { StatusDot, formatDay, EmptyLine, initials } from "./shared";
import { cn } from "@/lib/utils";

/**
 * Visual map of Project → Workstreams → Tasks.
 * Purely a different rendering of the existing data — no separate graph model,
 * no duplicated cards or tasks. Linking/unlinking a card in the Workstreams tab
 * adds/removes its node here automatically.
 */
export function ProjectMapTab({
  projectId, projectName, onOpenTab,
}: { projectId: string; projectName: string; onOpenTab: (tab: string) => void }) {
  const navigate = useNavigate();
  const { data: workstreams = [], isLoading } = useProjectWorkstreams(projectId);
  const { data: tasks = [] } = useProjectTasks(projectId);
  const [expanded, setExpanded] = useState<string | null>(null);

  const tasksByCard = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    for (const t of tasks) {
      if (!t.card_id) continue;
      const list = map.get(t.card_id) || [];
      list.push(t);
      map.set(t.card_id, list);
    }
    return map;
  }, [tasks]);

  // Organic radial layout: nodes spread around the project, slightly offset so
  // it never reads as a rigid flowchart.
  const positions = useMemo(() => {
    const n = workstreams.length;
    return workstreams.map((_, i) => {
      const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / Math.max(n, 1) + (n > 2 ? 0.18 : 0);
      const wobble = n > 3 ? (i % 2 === 0 ? 1 : 0.86) : 1;
      return {
        x: 50 + Math.cos(angle) * 33 * wobble,
        y: 50 + Math.sin(angle) * 31 * wobble,
      };
    });
  }, [workstreams]);

  if (isLoading) {
    return <div className="px-6 py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Map</h2>
        <p className="text-sm text-muted-foreground">
          This is the project, and these are all the connected areas of work around it.
        </p>
      </div>

      {workstreams.length === 0 ? (
        <EmptyLine>No workstreams connected yet — link a card in the Workstreams tab and it appears here.</EmptyLine>
      ) : (
        <div className="relative w-full rounded-2xl border border-border bg-card/60 overflow-hidden min-h-[560px] sm:min-h-[620px]">
          {/* soft backdrop */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,hsl(var(--primary)/0.07),transparent_62%)]" />

          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {positions.map((p, i) => (
              <line
                key={workstreams[i].id}
                x1="50%" y1="50%" x2={`${p.x}%`} y2={`${p.y}%`}
                stroke="hsl(var(--border))"
                strokeWidth={1.5}
                strokeLinecap="round"
                className={cn("transition-opacity", expanded && expanded !== workstreams[i].id && "opacity-40")}
              />
            ))}
          </svg>

          {/* Project node */}
          <button
            onClick={() => onOpenTab("overview")}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 max-w-[210px] rounded-full border border-primary/30 bg-background px-6 py-5 text-center shadow-sm hover:shadow-md hover:border-primary/60 transition-all"
          >
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Project</span>
            <span className="mt-1 block text-sm font-semibold text-foreground leading-snug line-clamp-2">{projectName}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {workstreams.length} workstream{workstreams.length === 1 ? "" : "s"}
            </span>
          </button>

          {/* Workstream nodes */}
          {workstreams.map((ws, i) => {
            const p = positions[i];
            const wsTasks = tasksByCard.get(ws.id) || [];
            const isOpen = expanded === ws.id;
            const pct = ws.tasks_total > 0 ? Math.round((ws.tasks_done / ws.tasks_total) * 100) : 0;
            return (
              <div
                key={ws.id}
                className="absolute z-20 w-[190px] sm:w-[212px] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div
                  className={cn(
                    "rounded-xl border bg-background shadow-sm transition-all",
                    isOpen ? "border-primary/50 shadow-md" : "border-border hover:border-primary/40 hover:shadow-md",
                  )}
                >
                  <button
                    onClick={() => navigate(taskCodeHref(ws.task_code))}
                    className="w-full text-left px-3.5 pt-3 pb-2"
                    title="Open the Workstream Card"
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot status={ws.status} />
                      <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">{ws.title}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono">{ws.task_code}</span>
                      <span>·</span>
                      <span>{RYG_META[ws.status]?.label}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[9px] font-medium text-secondary-foreground">
                        {initials(ws.owner_name)}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">{ws.owner_name || "No owner"}</span>
                      {ws.due_date && <span className="ml-auto text-[11px] text-muted-foreground">{formatDay(ws.due_date)}</span>}
                    </div>
                    {ws.tasks_total > 0 && (
                      <div className="mt-2.5">
                        <div className="h-1 w-full rounded-full bg-secondary">
                          <div className="h-1 rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="mt-1 block text-[10px] text-muted-foreground">{ws.tasks_done}/{ws.tasks_total} tasks done</span>
                      </div>
                    )}
                  </button>

                  <button
                    onClick={() => setExpanded(isOpen ? null : ws.id)}
                    className="flex w-full items-center justify-center gap-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {wsTasks.length > 0 ? `${wsTasks.length} task${wsTasks.length === 1 ? "" : "s"}` : "No tasks"}
                    <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
                  </button>

                  {isOpen && (
                    <ul className="max-h-40 overflow-y-auto border-t border-border px-3.5 py-2 space-y-1.5">
                      {wsTasks.length === 0 ? (
                        <li className="text-[11px] text-muted-foreground">Nothing under this workstream yet.</li>
                      ) : wsTasks.map((t) => (
                        <li key={t.id} className="flex items-start gap-2 text-[11px]">
                          <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", t.completed ? "bg-primary" : "bg-muted-foreground/40")} />
                          <span className={cn("flex-1 leading-snug", t.completed ? "text-muted-foreground line-through" : "text-foreground")}>
                            {t.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Click a workstream to open its card, or the task count to peek at its tasks. Nothing here is a copy — it's the same cards and tasks.
      </p>
    </div>
  );
}
