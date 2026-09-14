import { useMemo, useState } from "react";
import { Plus, Trash2, ChevronDown, Loader2, Check, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectMember } from "@/hooks/useProjects";
import {
  useProjectTasks, useCreateProjectTask, useToggleProjectTask, useDeleteProjectTask,
  useUpdateProjectTask, RYG_META, type ProjectWorkstream, type ProjectTask,
} from "@/hooks/useProjectWork";
import { StatusDot, formatDay, relativeDay, EmptyLine } from "./shared";

export interface AreaOfWorkTarget {
  /** null = the project's tasks that don't sit in any area of work */
  area: ProjectWorkstream | null;
}

/**
 * Right-side drawer for one Area of Work (an existing Workstream Card underneath).
 * Tasks shown here are the same underlying task objects the project progress uses —
 * nothing is duplicated.
 */
export function AreaOfWorkDrawer({
  projectId, members, target, onOpenChange,
}: {
  projectId: string;
  members: ProjectMember[];
  target: AreaOfWorkTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const area = target?.area ?? null;
  const { data: allTasks = [], isLoading } = useProjectTasks(projectId);
  const create = useCreateProjectTask(projectId);
  const toggle = useToggleProjectTask(projectId);
  const remove = useDeleteProjectTask(projectId);
  const update = useUpdateProjectTask(projectId);

  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("none");
  const [newDue, setNewDue] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const tasks = useMemo(
    () => allTasks.filter((t) => (area ? t.card_id === area.id : !t.card_id)),
    [allTasks, area],
  );
  const activeTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const completedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.completed)
        .sort((a, b) => {
          const aDate = a.completed_at || a.created_at;
          const bDate = b.completed_at || b.created_at;
          return bDate.localeCompare(aDate);
        }),
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

  const saveEdit = async (id: string) => {
    const title = editTitle.trim();
    if (title) await update.mutateAsync({ id, title });
    setEditing(null);
  };

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        <SheetHeader className="px-6 pt-6 pb-4 space-y-3 text-left">
          <div className="flex items-start gap-3">
            {area && <StatusDot status={area.status} className="mt-2" />}
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base leading-snug">
                {area ? area.title : "Tasks not in an area"}
              </SheetTitle>
              {area?.description && (
                <p className="mt-1 text-sm text-muted-foreground">{area.description}</p>
              )}
              {!area && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Work on this project that doesn't belong to a particular area yet.
                </p>
              )}
            </div>
          </div>

          {area && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono text-[10px]">{area.task_code}</span>
              <span>{area.owner_name || "No owner"}</span>
              <span>{RYG_META[area.status]?.label}</span>
              {area.due_date && <span>Due {formatDay(area.due_date)}</span>}
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{pct}% complete</span>
              <span>{done} of {tasks.length} tasks</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tasks</h3>
            {!adding && (
              <Button size="sm" variant="ghost" className="gap-1.5 h-8" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add task
              </Button>
            )}
          </div>

          {adding && (
            <div className="mb-3 space-y-2 rounded-lg border border-border p-3">
              <Input
                autoFocus
                placeholder="What needs to happen?"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
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
          )}

          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-3">
              {activeTasks.length === 0 ? (
                <EmptyLine>{tasks.length === 0 ? "No tasks here yet." : "Nothing outstanding here."}</EmptyLine>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {activeTasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      t={t}
                      editing={editing}
                      editTitle={editTitle}
                      setEditTitle={setEditTitle}
                      setEditing={setEditing}
                      saveEdit={saveEdit}
                      toggle={toggle}
                      remove={remove}
                    />
                  ))}
                </ul>
              )}

              {done > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <button
                    onClick={() => setShowCompleted((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
                    aria-expanded={showCompleted}
                  >
                    <span>Show completed tasks ({done})</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCompleted ? "rotate-180" : ""}`} />
                  </button>
                  {showCompleted && (
                    <ul className="divide-y divide-border border-t border-border bg-muted/20">
                      {completedTasks.map((t) => (
                        <li key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                          <Checkbox
                            className="mt-0.5"
                            checked={t.completed}
                            onCheckedChange={(v) => toggle.mutate({ id: t.id, completed: !!v })}
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
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskRow({
  t, editing, editTitle, setEditTitle, setEditing, saveEdit, toggle, remove,
}: {
  t: ProjectTask;
  editing: string | null;
  editTitle: string;
  setEditTitle: (v: string) => void;
  setEditing: (v: string | null) => void;
  saveEdit: (id: string) => Promise<void>;
  toggle: ReturnType<typeof useToggleProjectTask>;
  remove: ReturnType<typeof useDeleteProjectTask>;
}) {
  return (
    <li className="group flex items-start gap-3 px-4 py-3">
      <Checkbox
        className="mt-0.5"
        checked={t.completed}
        onCheckedChange={(v) => toggle.mutate({ id: t.id, completed: !!v })}
      />
      <div className="min-w-0 flex-1">
        {editing === t.id ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              className="h-8"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit(t.id);
                if (e.key === "Escape") setEditing(null);
              }}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveEdit(t.id)}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            className="text-left text-sm text-foreground hover:underline"
            onClick={() => { setEditing(t.id); setEditTitle(t.title); }}
          >
            {t.title}
          </button>
        )}
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
  );
}
