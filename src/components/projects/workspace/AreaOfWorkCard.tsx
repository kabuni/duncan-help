import { useMemo, useState } from "react";
import { Plus, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectMember } from "@/hooks/useProjects";
import {
  useCreateProjectTask, useToggleProjectTask, useDeleteProjectTask,
  RYG_META, type ProjectWorkstream, type ProjectTask,
} from "@/hooks/useProjectWork";
import { StatusDot, formatDay, relativeDay } from "./shared";

/**
 * One Area of Work shown inline on the Areas of Work page.
 * Active tasks are visible without opening the drawer; the drawer stays available
 * for fuller detail/editing. Tasks are the same underlying records — nothing duplicated.
 */
export function AreaOfWorkCard({
  projectId, area, tasks, members, onOpenDetail,
}: {
  projectId: string;
  /** null = tasks that don't sit in any area of work */
  area: ProjectWorkstream | null;
  tasks: ProjectTask[];
  members: ProjectMember[];
  onOpenDetail: () => void;
}) {
  const create = useCreateProjectTask(projectId);
  const toggle = useToggleProjectTask(projectId);
  const remove = useDeleteProjectTask(projectId);

  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("none");
  const [newDue, setNewDue] = useState("");

  const activeTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const completedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.completed)
        .sort((a, b) => (b.completed_at || b.created_at).localeCompare(a.completed_at || a.created_at)),
    [tasks],
  );
  const done = completedTasks.length;
  const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);

  const submit = async () => {
    if (!newTitle.trim()) return;
    await create.mutateAsync({
      title: newTitle.trim(),
      assignee_id: newAssignee === "none" ? null : newAssignee,
      due_date: newDue || null,
      card_id: area?.id ?? null,
    });
    setNewTitle(""); setNewAssignee("none"); setNewDue(""); setAdding(false);
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      {/* Header — click for the full detail drawer */}
      <button
        onClick={onOpenDetail}
        className="w-full text-left px-5 pt-4 pb-3 hover:bg-secondary/30 transition-colors rounded-t-xl"
      >
        <div className="flex items-center gap-2.5">
          {area ? <StatusDot status={area.status} /> : <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />}
          <span className="font-medium text-foreground truncate">{area ? area.title : "Tasks not in an area"}</span>
          {area && <span className="text-[10px] font-mono text-muted-foreground">{area.task_code}</span>}
        </div>
        {area?.description && (
          <p className="mt-1 ml-[18px] text-sm text-muted-foreground line-clamp-1">{area.description}</p>
        )}
        {area && (
          <div className="mt-1.5 ml-[18px] flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{area.owner_name || "No owner"}</span>
            <span>{RYG_META[area.status]?.label}</span>
            {area.due_date && <span>Due {formatDay(area.due_date)}</span>}
          </div>
        )}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{pct}% complete</span>
            <span>{done}/{tasks.length} tasks</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? "bg-emerald-500" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </button>

      {/* Tasks, inline */}
      <div className="px-5 pb-4">
        <ul className="divide-y divide-border/70 border-t border-border">
          {activeTasks.map((t) => (
            <li key={t.id} className="group flex items-start gap-3 py-2.5">
              <Checkbox
                className="mt-0.5"
                checked={t.completed}
                onCheckedChange={(v) => toggle.mutate({ id: t.id, completed: !!v })}
                aria-label={`Complete ${t.title}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{t.title}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span>{t.assignee_name || "Unassigned"}</span>
                  {t.due_date && <span>{relativeDay(t.due_date)}</span>}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => remove.mutate(t.id)}
                aria-label="Remove task"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </li>
          ))}
          {activeTasks.length === 0 && (
            <li className="py-2.5 text-sm text-muted-foreground">
              {tasks.length === 0 ? "No tasks here yet." : "Nothing outstanding here."}
            </li>
          )}
        </ul>

        {adding ? (
          <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
            <Input
              autoFocus
              placeholder="What needs to happen?"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setAdding(false); }}
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={newAssignee} onValueChange={setNewAssignee}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Assignee" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.display_name || "Unnamed"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" className="h-9" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewTitle(""); }}>Cancel</Button>
              <Button size="sm" onClick={submit} disabled={!newTitle.trim() || create.isPending}>
                {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Add task
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="mt-2 h-8 gap-1.5 -ml-2 text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add task
          </Button>
        )}

        {done > 0 && (
          <div className="mt-3 rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
              aria-expanded={showCompleted}
            >
              <span>Show completed tasks ({done})</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCompleted ? "rotate-180" : ""}`} />
            </button>
            {showCompleted && (
              <ul className="divide-y divide-border border-t border-border bg-muted/20">
                {completedTasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 px-3 py-2.5">
                    <Checkbox
                      className="mt-0.5"
                      checked={t.completed}
                      onCheckedChange={(v) => toggle.mutate({ id: t.id, completed: !!v })}
                      aria-label={`Reopen ${t.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-muted-foreground line-through">{t.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground/80">
                        <span>{t.assignee_name || "Unassigned"}</span>
                        {t.completed_at && <span>Completed {formatDay(t.completed_at)}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
