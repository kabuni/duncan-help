import { useState, useEffect } from "react";
import { Plus, CalendarDays, Tag, User, Flag, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateCard, useUserProfiles, useProjectTags, type CardStatus, type CardPriority } from "@/hooks/useWorkstreams";
import { useIsAdmin } from "@/hooks/useUserRoles";
import MultiAssigneeSelect from "./MultiAssigneeSelect";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefillTag?: string;
}

export default function CreateCardDialog({ open, onOpenChange, prefillTag }: Props) {
  const createCard = useCreateCard();
  const { data: users } = useUserProfiles();
  const { data: existingTags = [] } = useProjectTags();
  const { isAdmin } = useIsAdmin();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<CardStatus>("amber");
  const [priority] = useState<CardPriority>("medium");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [projectTag, setProjectTag] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newTag, setNewTag] = useState("");

  // Apply prefill when dialog opens with a suggested tag (from CEO Coverage Gaps)
  useEffect(() => {
    if (open && prefillTag) {
      setProjectTag(prefillTag);
      setTitle((t) => t || prefillTag);
    }
  }, [open, prefillTag]);

  const reset = () => {
    setTitle(""); setDescription(""); setStatus("amber");
    setAssigneeIds([]); setDueDate(""); setProjectTag("");
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    await createCard.mutateAsync({
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      owner_id: assigneeIds[0] || undefined,
      due_date: dueDate || undefined,
      project_tag: projectTag.trim() || undefined,
      assignee_ids: assigneeIds,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            New Workstream Card
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Q2 Product Launch" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What's this workstream about?" className="min-h-[80px]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1"><Flag className="h-3 w-3" /> Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as CardStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="red">🔴 Red</SelectItem>
                  <SelectItem value="amber">🟡 Yellow</SelectItem>
                  <SelectItem value="green">🟢 Green</SelectItem>
                  <SelectItem value="done">✅ Done</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Due Date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs font-medium flex items-center gap-1"><User className="h-3 w-3" /> Assignees</Label>
              <MultiAssigneeSelect
                users={users || []}
                selectedIds={assigneeIds}
                onChange={setAssigneeIds}
                placeholder="Assign people"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium flex items-center gap-1"><Tag className="h-3 w-3" /> Project / Workstream</Label>
            {addingNew ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newTag}
                  onChange={e => setNewTag(e.target.value)}
                  placeholder="New workstream name"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const v = newTag.trim();
                      if (v) { setProjectTag(v); setAddingNew(false); setNewTag(""); }
                    } else if (e.key === "Escape") {
                      setAddingNew(false); setNewTag("");
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="default"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    const v = newTag.trim();
                    if (v) { setProjectTag(v); setAddingNew(false); setNewTag(""); }
                  }}
                  disabled={!newTag.trim()}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0"
                  onClick={() => { setAddingNew(false); setNewTag(""); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Select
                value={projectTag || "none"}
                onValueChange={v => {
                  if (v === "__new__") { setAddingNew(true); return; }
                  setProjectTag(v === "none" ? "" : v);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select workstream" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {/* Ensure the currently selected tag (e.g. from prefill or admin add) is always present */}
                  {projectTag && !existingTags.includes(projectTag) && (
                    <SelectItem value={projectTag}>{projectTag}</SelectItem>
                  )}
                  {existingTags.map(tag => (
                    <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                  ))}
                  {isAdmin && (
                    <SelectItem value="__new__" className="text-primary font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Plus className="h-3 w-3" /> Add new workstream…
                      </span>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            {isAdmin && !addingNew && (
              <p className="text-[10px] text-muted-foreground">Admin: choose “Add new workstream…” to create a new tag.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || createCard.isPending}>
            {createCard.isPending ? "Creating…" : "Create Card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
