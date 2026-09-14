import { useState } from "react";
import { Plus, Loader2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import type { ProjectMember } from "@/hooks/useProjects";
import {
  useProjectTasks, useProjectWorkstreams, useCreateProjectTask, useToggleProjectTask, useDeleteProjectTask, type ProjectTask,
} from "@/hooks/useProjectWork";
import { taskCodeHref } from "@/components/TaskIdLink";
import { relativeDay, SectionTitle, EmptyLine } from "./shared";

export function ProjectTasksTab({
  projectId, projectName, members,
}: { projectId: string; projectName: string; members: ProjectMember[] }) {
  const { user } = useAuth();
  const { data: tasks = [], isLoading } = useProjectTasks(projectId);
  const { data: workstreams = [] } = useProjectWorkstreams(projectId);
  const [open, setOpen] = useState(false);

  const mine = tasks.filter((t) => t.assignee_id === user?.id);
  const team = tasks.filter((t) => t.assignee_id !== user?.id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Tasks</h2>
          <p className="text-sm text-muted-foreground">
            One task list for the project. A task can sit on its own or belong to a workstream.
          </p>
        </div>
        <Button size="sm" className="gap-2 shrink-0" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <section className="space-y-3">
            <SectionTitle>My tasks</SectionTitle>
            {mine.length === 0 ? <EmptyLine>Nothing assigned to you.</EmptyLine> : <TaskList tasks={mine} projectId={projectId} />}
          </section>
          <section className="space-y-3">
            <SectionTitle>Team tasks</SectionTitle>
            {team.length === 0 ? <EmptyLine>No team tasks yet.</EmptyLine> : <TaskList tasks={team} projectId={projectId} />}
          </section>
        </>
      )}

      <AddTaskDialog
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        members={members}
        workstreams={workstreams.map((w) => ({ id: w.id, label: `${w.title} · ${w.task_code}` }))}
      />
      <p className="text-xs text-muted-foreground">
        Tasks in {projectName} are the same underlying tasks shown on their workstream card — never a copy.
      </p>
    </div>
  );
}

export function TaskList({ tasks, projectId, compact = false }: { tasks: ProjectTask[]; projectId: string; compact?: boolean }) {
  const navigate = useNavigate();
  const toggle = useToggleProjectTask(projectId);
  const remove = useDeleteProjectTask(projectId);

  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {tasks.map((t) => (
        <li key={t.id} className="group flex items-start gap-3 px-5 py-3.5">
          <Checkbox
            checked={t.completed}
            onCheckedChange={(v) => toggle.mutate({ id: t.id, completed: !!v })}
            className="mt-0.5"
            aria-label={`Mark ${t.title} complete`}
          />
          <div className="flex-1 min-w-0">
            <p className={`text-sm ${t.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>{t.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{t.assignee_name || "Unassigned"}</span>
              {t.due_date && <span>{relativeDay(t.due_date)}</span>}
              {t.workstream_code && (
                <button
                  onClick={() => navigate(taskCodeHref(t.workstream_code!))}
                  className="hover:text-primary transition-colors"
                >
                  {t.workstream_title} · <span className="font-mono">{t.workstream_code}</span>
                </button>
              )}
            </div>
          </div>
          {!compact && (
            <button
              onClick={() => remove.mutate(t.id)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
              aria-label="Delete task"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddTaskDialog({
  open, onOpenChange, projectId, members, workstreams,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: string;
  members: ProjectMember[]; workstreams: Array<{ id: string; label: string }>;
}) {
  const create = useCreateProjectTask(projectId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [cardId, setCardId] = useState("none");

  const submit = async () => {
    if (!title.trim()) return;
    await create.mutateAsync({
      title: title.trim(),
      description: description.trim(),
      assignee_id: assignee || null,
      due_date: due || null,
      card_id: cardId === "none" ? null : cardId,
    });
    setTitle(""); setDescription(""); setAssignee(""); setDue(""); setCardId("none");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add task</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <Input placeholder="Task name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.display_name || "Unnamed"}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Select value={cardId} onValueChange={setCardId}>
            <SelectTrigger><SelectValue placeholder="Workstream (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No workstream</SelectItem>
              {workstreams.map((w) => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea placeholder="Description (optional)" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim() || create.isPending}>Add task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
