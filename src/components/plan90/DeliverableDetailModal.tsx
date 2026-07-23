import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Trash2, Save } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { PLAN90_PRIORITIES, PLAN90_STATUSES, type Plan90Deliverable, type Plan90Workstream } from "@/hooks/usePlan90";
import type { Plan90Ryg, Plan90Update } from "@/hooks/usePlan90Updates";
import { DeliverableUpdatesPanel } from "@/components/plan90/DeliverableUpdatesPanel";
import { AttachmentsPanel } from "@/components/plan90/AttachmentsPanel";

interface Owner { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: Plan90Deliverable;
  workstreams: Plan90Workstream[];
  owners: Owner[];
  isAdmin: boolean;
  currentUserId: string | null;
  updates: Plan90Update[];
  onUpdate: (id: string, patch: Partial<Plan90Deliverable>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onPostUpdate: (deliverableId: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onEditUpdate: (id: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onDeleteUpdate: (id: string) => Promise<boolean>;
}

const statusColor: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground border-border",
  "In Progress": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  "Completed": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};
const priorityColor: Record<string, string> = {
  Critical: "bg-red-500/10 text-red-500 border-red-500/30",
  High: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  Medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  Low: "bg-muted text-muted-foreground border-border",
};

export function DeliverableDetailModal({
  open, onOpenChange, item, workstreams, owners, isAdmin, currentUserId, updates,
  onUpdate, onDelete, onPostUpdate, onEditUpdate, onDeleteUpdate,
}: Props) {
  const [title, setTitle] = useState(item.title);
  const [editTitle, setEditTitle] = useState(false);
  useEffect(() => { setTitle(item.title); setEditTitle(false); }, [item.id, item.title]);

  const disabled = !isAdmin;

  async function saveTitle() {
    if (title.trim() && title !== item.title) await onUpdate(item.id, { title: title.trim() });
    setEditTitle(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] p-0 flex flex-col max-h-[90vh] gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border space-y-2">
          {editTitle && isAdmin ? (
            <div className="flex items-center gap-1.5 pr-8">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="h-9 text-base font-semibold"
                onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitle(item.title); setEditTitle(false); } }} />
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveTitle}><Save className="h-4 w-4" /></Button>
            </div>
          ) : (
            <DialogTitle
              className={cn("text-base font-semibold leading-snug pr-8 text-left", isAdmin && "cursor-text hover:text-primary")}
              onClick={() => isAdmin && setEditTitle(true)}
            >
              {item.title}
            </DialogTitle>
          )}
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {/* Metadata grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Owner">
              <Select disabled={disabled} value={item.owner_user_id || "__none"} onValueChange={(v) => {
                if (v === "__none") return onUpdate(item.id, { owner_user_id: null });
                const o = owners.find((x) => x.id === v);
                onUpdate(item.id, { owner_user_id: v, owner_display_name: o?.name || null });
              }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue>
                    {item.owner_user_id ? owners.find((o) => o.id === item.owner_user_id)?.name || item.owner_display_name : (item.owner_display_name || <span className="text-muted-foreground">Unassigned</span>)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {item.owner_display_name && !owners.find((o) => o.id === item.owner_user_id) && (
                    <SelectItem value={item.owner_user_id || "__legacy"} disabled>{item.owner_display_name} (external)</SelectItem>
                  )}
                  {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Due date">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" disabled={disabled} className="h-8 justify-start font-normal text-xs w-full">
                    <CalendarIcon className="h-3 w-3 mr-1.5" />
                    {item.due_date ? format(new Date(item.due_date), "d MMM yyyy") : "—"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar mode="single" selected={item.due_date ? new Date(item.due_date) : undefined}
                    onSelect={(d) => d && onUpdate(item.id, { due_date: format(d, "yyyy-MM-dd") })}
                    className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </Field>

            <Field label="Status">
              <Select disabled={disabled} value={item.status} onValueChange={(v) => onUpdate(item.id, { status: v })}>
                <SelectTrigger className={cn("h-8 text-xs border", statusColor[item.status] || "")}><SelectValue /></SelectTrigger>
                <SelectContent>{PLAN90_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>

            <Field label="Priority">
              <Select disabled={disabled} value={item.priority} onValueChange={(v) => onUpdate(item.id, { priority: v })}>
                <SelectTrigger className={cn("h-8 text-xs border", priorityColor[item.priority] || "")}><SelectValue /></SelectTrigger>
                <SelectContent>{PLAN90_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </Field>

            <Field label="Workstream">
              <Select disabled={disabled} value={item.workstream_id} onValueChange={(v) => onUpdate(item.id, { workstream_id: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{workstreams.filter((w) => !w.archived).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>

          {/* Updates */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Updates ({updates.length})</h3>
            <DeliverableUpdatesPanel
              deliverableId={item.id}
              updates={updates}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              canPost={!!currentUserId}
              onPost={onPostUpdate}
              onEdit={onEditUpdate}
              onDelete={onDeleteUpdate}
            />
          </section>

          {/* Attachments */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Files</h3>
            <AttachmentsPanel deliverableId={item.id} isAdmin={isAdmin} />
          </section>
        </div>

        {isAdmin && (
          <div className="px-5 py-3 border-t border-border flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={async () => {
                if (confirm(`Delete "${item.title}"?`)) {
                  const ok = await onDelete(item.id);
                  if (ok) onOpenChange(false);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete deliverable
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</label>
      {children}
    </div>
  );
}
