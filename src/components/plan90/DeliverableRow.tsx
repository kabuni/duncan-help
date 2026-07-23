import { useState } from "react";
import type { Plan90Deliverable, Plan90Workstream } from "@/hooks/usePlan90";
import { PLAN90_STATUSES } from "@/hooks/usePlan90";
import type { Plan90Ryg, Plan90Update } from "@/hooks/usePlan90Updates";
import { LatestUpdateCell } from "@/components/plan90/LatestUpdateCell";
import { DeliverableDetailModal } from "@/components/plan90/DeliverableDetailModal";
import { DeliverableUpdatesPanel } from "@/components/plan90/DeliverableUpdatesPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Owner { id: string; name: string }

interface Props {
  item: Plan90Deliverable;
  workstreams: Plan90Workstream[];
  owners: Owner[];
  isAdmin: boolean;
  latestUpdate: Plan90Update | undefined;
  updates: Plan90Update[];
  currentUserId: string | null;
  onUpdate: (id: string, patch: Partial<Plan90Deliverable>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onPostUpdate: (deliverableId: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onEditUpdate: (id: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onDeleteUpdate: (id: string) => Promise<boolean>;
}

const statusDot: Record<string, string> = {
  "Not Started": "bg-muted-foreground/40",
  "In Progress": "bg-amber-500",
  "Completed": "bg-emerald-500",
};

const priorityChip: Record<string, string> = {
  Critical: "text-red-500",
  High: "text-orange-500",
  Medium: "text-amber-600 dark:text-amber-400",
  Low: "text-muted-foreground",
};

export function DeliverableRow(props: Props) {
  const { item, latestUpdate, owners, isAdmin } = props;
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const dueDate = item.due_date ? new Date(item.due_date) : null;
  const isOverdue = !!dueDate && dueDate < today && item.status !== "Completed";
  const isDueSoon = !!dueDate && !isOverdue && dueDate >= today && dueDate <= in7 && item.status !== "Completed";

  const ownerName = item.owner_user_id
    ? (owners.find((o) => o.id === item.owner_user_id)?.name || item.owner_display_name)
    : item.owner_display_name;

  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/60 hover:bg-secondary/40 transition-colors",
          isOverdue && "bg-red-500/[0.03]",
          isDueSoon && "bg-yellow-500/[0.04]",
        )}
      >
        {/* Deliverable — status dot + title + priority chip */}
        <td className="px-3 py-2 align-middle min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn("h-2 w-2 rounded-full shrink-0", statusDot[item.status] || "bg-muted-foreground/40")}
              title={item.status}
            />
            <span className="text-sm text-foreground truncate min-w-0 flex-1">{item.title}</span>
            {item.priority && item.priority !== "Medium" && (
              <span className={cn("text-[10px] font-medium shrink-0 uppercase tracking-wider", priorityChip[item.priority])}>
                {item.priority}
              </span>
            )}
          </div>
        </td>

        {/* Owner — inline editable */}
        <td className="px-2 py-1 align-middle w-[150px] max-w-[150px]" onClick={stop}>
          {isAdmin ? (
            <Select
              value={item.owner_user_id ?? "__none"}
              onValueChange={(v) => {
                const owner = owners.find((o) => o.id === v);
                props.onUpdate(item.id, {
                  owner_user_id: v === "__none" ? null : v,
                  owner_display_name: v === "__none" ? null : (owner?.name ?? null),
                });
              }}
            >
              <SelectTrigger className="h-7 border-transparent bg-transparent hover:bg-secondary/60 px-2 text-xs shadow-none focus:ring-1 truncate">
                <SelectValue placeholder="Unassigned">
                  <span className="truncate">{ownerName || <span className="italic opacity-60">Unassigned</span>}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unassigned</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground truncate block px-2">
              {ownerName || <span className="italic opacity-60">Unassigned</span>}
            </span>
          )}
        </td>

        {/* Status — inline editable */}
        <td className="px-2 py-1 align-middle w-[130px]" onClick={stop}>
          {isAdmin ? (
            <Select value={item.status} onValueChange={(v) => props.onUpdate(item.id, { status: v })}>
              <SelectTrigger className="h-7 border-transparent bg-transparent hover:bg-secondary/60 px-2 text-xs shadow-none focus:ring-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN90_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground px-2">{item.status}</span>
          )}
        </td>

        {/* Due — inline editable */}
        <td className="px-2 py-1 align-middle w-[110px]" onClick={stop}>
          {isAdmin ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 font-normal text-xs w-full justify-start hover:bg-secondary/60",
                    isOverdue && "text-red-500 font-medium",
                    isDueSoon && "text-yellow-600 dark:text-yellow-400",
                    !isOverdue && !isDueSoon && "text-muted-foreground",
                  )}
                >
                  {item.due_date ? format(new Date(item.due_date), "d MMM") : "—"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={dueDate ?? undefined}
                  onSelect={(d) => props.onUpdate(item.id, { due_date: d ? format(d, "yyyy-MM-dd") : null })}
                  className="p-3 pointer-events-auto"
                />
                {item.due_date && (
                  <div className="border-t p-2 flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => props.onUpdate(item.id, { due_date: null })}>Clear</Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            <span
              className={cn(
                "text-xs whitespace-nowrap px-2",
                isOverdue && "text-red-500 font-medium",
                isDueSoon && "text-yellow-600 dark:text-yellow-400",
                !isOverdue && !isDueSoon && "text-muted-foreground",
              )}
            >
              {item.due_date ? format(new Date(item.due_date), "d MMM") : "—"}
            </span>
          )}
        </td>

        {/* Latest update — click opens updates-only popup */}
        <td className="px-3 py-2 align-middle min-w-0">
          <button
            type="button"
            onClick={() => setUpdatesOpen(true)}
            className="w-full text-left min-w-0 group flex items-center gap-2"
            title="View all updates"
          >
            <div className="flex-1 min-w-0">
              <LatestUpdateCell latest={latestUpdate} />
            </div>
            <span className="text-[10px] text-muted-foreground/70 group-hover:text-foreground shrink-0 hidden sm:inline">
              More
            </span>
          </button>
        </td>

        {/* Admin overflow — edit title, priority, notes, delete */}
        {isAdmin && (
          <td className="px-1 py-1 align-middle w-[36px]" onClick={stop}>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setDetailOpen(true)}
              title="More options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </td>
        )}
      </tr>

      {/* Updates-only popup */}
      <Dialog open={updatesOpen} onOpenChange={setUpdatesOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle className="text-base">{item.title}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <DeliverableUpdatesPanel
              deliverableId={item.id}
              updates={props.updates}
              currentUserId={props.currentUserId}
              isAdmin={props.isAdmin}
              canPost={!!props.currentUserId}
              onPost={props.onPostUpdate}
              onEdit={props.onEditUpdate}
              onDelete={props.onDeleteUpdate}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Full detail modal (admin overflow) */}
      <DeliverableDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        item={item}
        workstreams={props.workstreams}
        owners={props.owners}
        isAdmin={props.isAdmin}
        currentUserId={props.currentUserId}
        updates={props.updates}
        onUpdate={props.onUpdate}
        onDelete={props.onDelete}
        onPostUpdate={props.onPostUpdate}
        onEditUpdate={props.onEditUpdate}
        onDeleteUpdate={props.onDeleteUpdate}
      />
    </>
  );
}
