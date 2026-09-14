import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectMember } from "@/hooks/useProjects";
import { useUpdateProjectTask, type ProjectTask } from "@/hooks/useProjectWork";

/** Lightweight popover for editing a task in place — name, details, owner, due date. */
export function TaskEditPopover({
  projectId, task, members, children,
}: {
  projectId: string;
  task: ProjectTask;
  members: ProjectMember[];
  children: React.ReactNode;
}) {
  const update = useUpdateProjectTask(projectId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [assignee, setAssignee] = useState(task.assignee_id || "none");
  const [due, setDue] = useState(task.due_date || "");

  const onOpenChange = (v: boolean) => {
    if (v) {
      setTitle(task.title);
      setDescription(task.description || "");
      setAssignee(task.assignee_id || "none");
      setDue(task.due_date || "");
    }
    setOpen(v);
  };

  const save = async () => {
    if (!title.trim()) return;
    await update.mutateAsync({
      id: task.id,
      title: title.trim(),
      description: description.trim(),
      assignee_id: assignee === "none" ? null : assignee,
      due_date: due || null,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Task</Label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Details</Label>
          <Textarea rows={3} placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Owner</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>{m.display_name || "Unnamed"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Due date</Label>
            <Input type="date" className="h-9" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!title.trim() || update.isPending}>
            {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
