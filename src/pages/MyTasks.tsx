import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ListChecks,
  Plus,
  Sparkles,
  Loader2,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyPendingTasks } from "@/hooks/useHomeDashboard";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImportTasksFromNotesDialog } from "@/components/projects/ImportTasksFromNotesDialog";
import TodoSection, { NewTodoDialog } from "@/components/todos/TodoSection";
import type { ProjectMember } from "@/hooks/useProjects";


/* ------------ helpers ------------ */
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

type TaskKind = "workstream" | "project";

type UnifiedTask = {
  id: string;
  raw_id: string;
  kind: TaskKind;
  title: string;
  source: "Workstream" | "Project";
  context: string;
  status: string;
  due_date: string | null;
  deadline: string | null;
  notes: string | null;
  href: string;
};

type Project = { id: string; name: string };

/* ------------ data ------------ */
function useProjectTasks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-tasks", "project-tasks", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const ids = [user!.id];
      const { data: prof } = await supabase.from("profiles").select("id").eq("user_id", user!.id).maybeSingle();
      if (prof?.id) ids.push(prof.id);
      const { data, error } = await supabase
        .from("project_chat_plan_items")
        .select("id,title,status,due_date,deadline,notes,project_id,projects(name)")
        .in("assignee_profile_id", ids)
        .neq("status", "done");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        due_date: r.due_date,
        deadline: r.deadline,
        notes: r.notes,
        project_id: r.project_id,
        project_name: r.projects?.name ?? "Project",
      }));
    },
  });
}

function useAllProjects() {
  return useQuery<Project[]>({
    queryKey: ["my-tasks", "projects-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
}

async function loadProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data: project } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .single();
  if (!project) return [];
  const { data: memberRows } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  const userIds = Array.from(new Set([project.user_id, ...(memberRows ?? []).map((r: any) => r.user_id)]));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, display_name, role_title, avatar_url")
    .in("user_id", userIds);
  const map = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
  const owner = map.get(project.user_id);
  return [
    {
      user_id: project.user_id,
      display_name: owner?.display_name ?? null,
      role_title: owner?.role_title ?? null,
      avatar_url: owner?.avatar_url ?? null,
      isOwner: true,
    },
    ...(memberRows ?? []).map((r: any) => {
      const p = map.get(r.user_id);
      return {
        user_id: r.user_id,
        display_name: p?.display_name ?? null,
        role_title: p?.role_title ?? null,
        avatar_url: p?.avatar_url ?? null,
        isOwner: false,
      } as ProjectMember;
    }),
  ];
}

/* ------------ mutations ------------ */
async function markComplete(task: UnifiedTask, completed: boolean) {
  if (task.kind === "workstream") {
    const { error } = await supabase
      .from("workstream_tasks")
      .update({ completed, status: completed ? "done" : "todo" })
      .eq("id", task.raw_id);
    if (error) throw error;
  } else {
    const { error } = await (supabase as any)
      .from("project_chat_plan_items")
      .update({
        status: completed ? "done" : "accepted",
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", task.raw_id);
    if (error) throw error;
  }
}

async function updateTaskFields(
  task: UnifiedTask,
  fields: { due_date: string | null; deadline: string | null; notes: string | null },
) {
  if (task.kind === "workstream") {
    const { error } = await supabase
      .from("workstream_tasks")
      .update({ due_date: fields.due_date, description: fields.notes })
      .eq("id", task.raw_id);
    if (error) throw error;
  } else {
    const { error } = await (supabase as any)
      .from("project_chat_plan_items")
      .update({
        due_date: fields.due_date,
        deadline: fields.deadline,
        notes: fields.notes,
      })
      .eq("id", task.raw_id);
    if (error) throw error;
  }
}

/* ------------ new task dialog ------------ */
function NewTaskDialog({
  open,
  onOpenChange,
  projects,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: Project[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [deadline, setDeadline] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDueDate("");
      setDeadline("");
      setNotes("");
      setProjectId(projects[0]?.id ?? "");
    }
  }, [open, projects]);

  async function submit() {
    if (!title.trim()) return toast.error("Title is required");
    if (!projectId) return toast.error("Pick a project");
    if (!user) return;
    setSaving(true);
    try {
      let chatId: string | null = null;
      const { data: existingChat } = await supabase
        .from("project_chats")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      chatId = existingChat?.id ?? null;
      if (!chatId) {
        const { data: created, error: cErr } = await supabase
          .from("project_chats")
          .insert({ project_id: projectId, title: "Tasks" })
          .select("id")
          .single();
        if (cErr) throw cErr;
        chatId = created.id;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      const { error } = await supabase.from("project_chat_plan_items" as any).insert({
        project_id: projectId,
        chat_id: chatId,
        created_by: user.id,
        title: title.trim(),
        status: "accepted",
        assignee_profile_id: profile?.id ?? user.id,
        due_date: dueDate || null,
        deadline: deadline || null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success("Task added");
      onOpenChange(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message || "Failed to create task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> New task
          </DialogTitle>
          <DialogDescription className="text-xs">
            Assign it to a project. It shows up on your dashboard and in that project's task list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="task-title" className="text-xs">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Draft investor update"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-due" className="text-xs">Due date</Label>
              <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-deadline" className="text-xs">Hard deadline</Label>
              <Input id="task-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-notes" className="text-xs">Notes</Label>
            <Textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, links, acceptance criteria…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Add task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------ edit task dialog ------------ */
function EditTaskDialog({
  task,
  onOpenChange,
  onSaved,
}: {
  task: UnifiedTask | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [dueDate, setDueDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!task) return;
    setDueDate(task.due_date ?? "");
    setDeadline(task.deadline ?? "");
    setNotes(task.notes ?? "");

    // For workstream tasks the list query doesn't include description; fetch it.
    if (task.kind === "workstream") {
      setLoading(true);
      supabase
        .from("workstream_tasks")
        .select("description")
        .eq("id", task.raw_id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.description != null) setNotes(data.description);
        })
        .then(() => setLoading(false));
    }
  }, [task]);

  if (!task) return null;

  async function save() {
    if (!task) return;
    setSaving(true);
    try {
      await updateTaskFields(task, {
        due_date: dueDate || null,
        deadline: task.kind === "project" ? (deadline || null) : null,
        notes: notes.trim() || null,
      });
      toast.success("Task updated");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to update task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!task} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base truncate">{task.title}</DialogTitle>
          <DialogDescription className="text-xs">
            <span className="uppercase tracking-widest">{task.source}</span> · {task.context}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className={`grid gap-3 ${task.kind === "project" ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="space-y-1.5">
              <Label htmlFor="edit-due" className="text-xs">Due date</Label>
              <Input id="edit-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            {task.kind === "project" && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-deadline" className="text-xs">Hard deadline</Label>
                <Input id="edit-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes" className="text-xs">
              Notes {loading && <Loader2 className="h-3 w-3 inline animate-spin ml-1" />}
            </Label>
            <Textarea
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Context, links, acceptance criteria…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------ pick-project step for import ------------ */
function PickProjectForImport({
  open,
  onOpenChange,
  projects,
  onPicked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: Project[];
  onPicked: (p: Project) => void;
}) {
  const [projectId, setProjectId] = useState<string>("");
  useEffect(() => { if (open) setProjectId(projects[0]?.id ?? ""); }, [open, projects]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Import from meetings
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pick the project these action items belong to. Duncan will pull them from Gemini or Plaud meeting notes in your Gmail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              const p = projects.find((x) => x.id === projectId);
              if (!p) return toast.error("Pick a project");
              onPicked(p);
            }}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------ page ------------ */
export default function MyTasks() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ws = useMyPendingTasks();
  const proj = useProjectTasks();
  const { data: projects = [] } = useAllProjects();

  const [newOpen, setNewOpen] = useState(false);
  const [newTodoOpen, setNewTodoOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [importProject, setImportProject] = useState<Project | null>(null);
  const [importMembers, setImportMembers] = useState<ProjectMember[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<UnifiedTask | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());


  const tasks: UnifiedTask[] = useMemo(() => {
    const a: UnifiedTask[] = (ws.data ?? []).map((t: any) => ({
      id: `ws-${t.id}`,
      raw_id: t.id,
      kind: "workstream" as TaskKind,
      title: t.title,
      source: "Workstream" as const,
      context: t.card_title,
      status: t.status,
      due_date: t.due_date,
      deadline: null,
      notes: null,
      href: `/workstreams?card=${t.card_id}`,
    }));
    const b: UnifiedTask[] = (proj.data ?? []).map((t: any) => ({
      id: `pj-${t.id}`,
      raw_id: t.id,
      kind: "project" as TaskKind,
      title: t.title,
      source: "Project" as const,
      context: t.project_name,
      status: t.status,
      due_date: t.due_date,
      deadline: t.deadline,
      notes: t.notes,
      href: `/projects/${t.project_id}`,
    }));
    return [...a, ...b];
  }, [ws.data, proj.data]);

  const buckets = useMemo(() => {
    const today = startOfDay();
    const eod = endOfDay();
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const overdue: UnifiedTask[] = [];
    const dueToday: UnifiedTask[] = [];
    const upcoming: UnifiedTask[] = [];
    const later: UnifiedTask[] = [];
    for (const t of tasks) {
      const anchor = t.due_date || t.deadline;
      if (!anchor) { later.push(t); continue; }
      const d = new Date(anchor + "T00:00:00");
      if (d < today) overdue.push(t);
      else if (d <= eod) dueToday.push(t);
      else if (d <= in7) upcoming.push(t);
      else later.push(t);
    }
    const byDate = (a: UnifiedTask, b: UnifiedTask) =>
      ((a.due_date || a.deadline) || "").localeCompare((b.due_date || b.deadline) || "");
    return {
      overdue: overdue.sort(byDate),
      dueToday: dueToday.sort(byDate),
      upcoming: upcoming.sort(byDate),
      later,
    };
  }, [tasks]);

  const isLoading = ws.isLoading || proj.isLoading;

  async function handlePicked(p: Project) {
    setImportProject(p);
    setPickOpen(false);
    try {
      const members = await loadProjectMembers(p.id);
      setImportMembers(members);
      setImportOpen(true);
    } catch {
      toast.error("Failed to load project members");
    }
  }

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["my-tasks"] });
    qc.invalidateQueries({ queryKey: ["home-briefing"] });
    qc.invalidateQueries({ queryKey: ["home-dashboard"] });
    ws.refetch?.();
    proj.refetch();
  }

  async function handleToggle(task: UnifiedTask, next: boolean) {
    setBusyIds((s) => new Set(s).add(task.id));
    try {
      await markComplete(task, next);
      toast.success(next ? "Marked complete" : "Reopened");
      refetchAll();
    } catch (e: any) {
      toast.error(e.message || "Update failed");
    } finally {
      setBusyIds((s) => {
        const n = new Set(s); n.delete(task.id); return n;
      });
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            onClick={() => navigate("/")}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
          >
            <ChevronLeft className="h-3 w-3" /> Home
          </button>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> My tasks
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Your to-dos, plus everything assigned to you across workstreams and projects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPickOpen(true)}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Import from meetings
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNewTodoOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New to-do
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New task
          </Button>
        </div>
      </div>

      <TodoSection />

      {isLoading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (

        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">You're all clear. No open tasks assigned to you.</p>
          <Button size="sm" className="mt-4" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add your first task
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {buckets.overdue.length > 0 && (
            <Bucket
              title={`Overdue · ${buckets.overdue.length}`} tone="overdue" rows={buckets.overdue}
              busyIds={busyIds} onToggle={handleToggle} onEdit={setEditing} onOpen={(t) => navigate(t.href)}
            />
          )}
          {buckets.dueToday.length > 0 && (
            <Bucket
              title={`Due today · ${buckets.dueToday.length}`} tone="today" rows={buckets.dueToday}
              busyIds={busyIds} onToggle={handleToggle} onEdit={setEditing} onOpen={(t) => navigate(t.href)}
            />
          )}
          {buckets.upcoming.length > 0 && (
            <Bucket
              title={`Next 7 days · ${buckets.upcoming.length}`} tone="upcoming" rows={buckets.upcoming}
              busyIds={busyIds} onToggle={handleToggle} onEdit={setEditing} onOpen={(t) => navigate(t.href)}
            />
          )}
          {buckets.later.length > 0 && (
            <Bucket
              title={`Later / no due date · ${buckets.later.length}`} rows={buckets.later}
              busyIds={busyIds} onToggle={handleToggle} onEdit={setEditing} onOpen={(t) => navigate(t.href)}
            />
          )}
        </div>
      )}

      <NewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projects={projects}
        onCreated={refetchAll}
      />
      <PickProjectForImport
        open={pickOpen}
        onOpenChange={setPickOpen}
        projects={projects}
        onPicked={handlePicked}
      />
      {importProject && (
        <ImportTasksFromNotesDialog
          open={importOpen}
          onOpenChange={(v) => {
            setImportOpen(v);
            if (!v) setImportProject(null);
          }}
          projectId={importProject.id}
          members={importMembers}
          onImported={refetchAll}
        />
      )}
      <EditTaskDialog
        task={editing}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        onSaved={refetchAll}
      />
    </div>
  );
}

function Bucket({
  title,
  tone,
  rows,
  busyIds,
  onToggle,
  onEdit,
  onOpen,
}: {
  title: string;
  tone?: "overdue" | "today" | "upcoming";
  rows: UnifiedTask[];
  busyIds: Set<string>;
  onToggle: (t: UnifiedTask, next: boolean) => void;
  onEdit: (t: UnifiedTask) => void;
  onOpen: (t: UnifiedTask) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 py-2.5 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <ul className="divide-y divide-border/60">
        {rows.map((t) => {
          const anchor = t.due_date || t.deadline;
          const dueLabel = anchor ? format(new Date(anchor + "T00:00:00"), "d MMM yyyy") : "No date";
          const dueClass =
            tone === "overdue" ? "text-destructive font-semibold" :
            tone === "today" ? "text-amber-600 dark:text-amber-400 font-medium" :
            "text-muted-foreground";
          const busy = busyIds.has(t.id);
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
              <div className="pt-0.5">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Checkbox
                    aria-label="Mark complete"
                    checked={false}
                    onCheckedChange={(v) => onToggle(t, !!v)}
                  />
                )}
              </div>
              <button
                onClick={() => onEdit(t)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="text-sm font-medium text-foreground truncate">{t.title}</div>
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                  <span className="uppercase tracking-widest mr-1.5">{t.source}</span>
                  · {t.context}
                  {t.notes && <span className="ml-1.5">· {t.notes.replace(/\s+/g, " ").slice(0, 60)}{t.notes.length > 60 ? "…" : ""}</span>}
                  {t.kind === "project" && t.deadline && t.due_date && t.deadline !== t.due_date && (
                    <span className="ml-1.5">· deadline {format(new Date(t.deadline + "T00:00:00"), "d MMM")}</span>
                  )}
                </div>
              </button>
              <div className={`text-xs tabular-nums shrink-0 ${dueClass}`}>{dueLabel}</div>
              <button
                onClick={() => onOpen(t)}
                className="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground shrink-0"
                aria-label="Open source"
                title="Open source"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
