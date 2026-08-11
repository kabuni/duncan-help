import { useState } from "react";
import { format } from "date-fns";
import { CheckSquare, Plus, Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

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

import {
  useTodos,
  useCreateTodo,
  useToggleTodo,
  useDeleteTodo,
  useAssignableUsers,
  type Todo,
  type TodoPriority,
} from "@/hooks/useTodos";

const PRIORITY_LABEL: Record<TodoPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function priorityClass(p: TodoPriority) {
  if (p === "high") return "text-destructive";
  if (p === "low") return "text-muted-foreground";
  return "text-amber-600 dark:text-amber-400";
}

export function NewTodoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateTodo();
  const { data: people = [] } = useAssignableUsers();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [assignee, setAssignee] = useState<string>("me");

  const reset = () => {
    setTitle(""); setNotes(""); setDueDate(""); setPriority("medium"); setAssignee("me");
  };

  async function submit() {
    if (!title.trim()) return toast.error("Title is required");
    try {
      await create.mutateAsync({
        title,
        notes,
        due_date: dueDate || null,
        priority,
        assignee_user_id: assignee === "me" ? null : assignee,
      });
      toast.success("To-do added");
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to add to-do");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckSquare className="h-4 w-4" /> New to-do
          </DialogTitle>
          <DialogDescription className="text-xs">
            An individual action — something one person needs to do. Use Workstreams for
            company-wide collaborative initiatives.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="todo-title" className="text-xs">Title</Label>
            <Input
              id="todo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Send the deck to Palash"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-due" className="text-xs">Due date</Label>
              <Input id="todo-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TodoPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><UserPlus className="h-3 w-3" /> Assign to</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Me</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="todo-notes" className="text-xs">Notes</Label>
            <Textarea
              id="todo-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Context or links…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Add to-do
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TodoSection() {
  const { data: todos = [], isLoading } = useTodos();
  const toggle = useToggleTodo();
  const del = useDeleteTodo();
  const [open, setOpen] = useState(false);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          To-Dos · {todos.length}
        </span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New to-do
        </Button>
      </div>

      {isLoading ? (
        <div className="py-6 flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : todos.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">
          No open to-dos. Individual actions live here — collaborative initiatives belong in Workstreams.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {todos.map((t: Todo) => {
            const overdue = t.due_date && new Date(t.due_date + "T00:00:00") < today;
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                <Checkbox
                  aria-label="Mark complete"
                  checked={t.completed}
                  disabled={toggle.isPending}
                  onCheckedChange={(v) => toggle.mutate({ id: t.id, completed: !!v })}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    <span className={`uppercase tracking-widest mr-1.5 ${priorityClass(t.priority)}`}>
                      {PRIORITY_LABEL[t.priority] ?? t.priority}
                    </span>
                    {t.created_by_name && <span>· from {t.created_by_name} </span>}
                    {t.assignee_name && <span>· for {t.assignee_name} </span>}
                    {t.notes && (
                      <span>· {t.notes.replace(/\s+/g, " ").slice(0, 60)}{t.notes.length > 60 ? "…" : ""}</span>
                    )}
                  </div>
                </div>
                <div className={`text-xs tabular-nums shrink-0 ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {t.due_date ? format(new Date(t.due_date + "T00:00:00"), "d MMM yyyy") : "No date"}
                </div>
                <button
                  onClick={() => del.mutate(t.id)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-destructive shrink-0"
                  aria-label="Delete to-do"
                  title="Delete to-do"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <NewTodoDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
