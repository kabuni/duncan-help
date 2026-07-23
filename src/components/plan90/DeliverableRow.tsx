import { useState } from "react";
import type { Plan90Deliverable, Plan90Workstream } from "@/hooks/usePlan90";
import type { Plan90Ryg, Plan90Update } from "@/hooks/usePlan90Updates";
import { LatestUpdateCell } from "@/components/plan90/LatestUpdateCell";
import { DeliverableDetailModal } from "@/components/plan90/DeliverableDetailModal";
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
  const { item, latestUpdate, owners } = props;
  const [open, setOpen] = useState(false);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const dueDate = item.due_date ? new Date(item.due_date) : null;
  const isOverdue = !!dueDate && dueDate < today && item.status !== "Completed";
  const isDueSoon = !!dueDate && !isOverdue && dueDate >= today && dueDate <= in7 && item.status !== "Completed";

  const ownerName = item.owner_user_id
    ? (owners.find((o) => o.id === item.owner_user_id)?.name || item.owner_display_name)
    : item.owner_display_name;

  return (
    <>
      <tr
        onClick={() => setOpen(true)}
        className={cn(
          "border-b border-border/60 hover:bg-secondary/40 transition-colors cursor-pointer",
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

        {/* Owner */}
        <td className="px-3 py-2 align-middle w-[140px] max-w-[140px]">
          <span className="text-xs text-muted-foreground truncate block">
            {ownerName || <span className="italic opacity-60">Unassigned</span>}
          </span>
        </td>

        {/* Due */}
        <td className="px-3 py-2 align-middle w-[100px]">
          <span
            className={cn(
              "text-xs whitespace-nowrap",
              isOverdue && "text-red-500 font-medium",
              isDueSoon && "text-yellow-600 dark:text-yellow-400",
              !isOverdue && !isDueSoon && "text-muted-foreground",
            )}
          >
            {item.due_date ? format(new Date(item.due_date), "d MMM") : "—"}
          </span>
        </td>

        {/* Latest update — flexes to fill remaining space, truncated */}
        <td className="px-3 py-2 align-middle min-w-0">
          <LatestUpdateCell latest={latestUpdate} />
        </td>
      </tr>

      <DeliverableDetailModal
        open={open}
        onOpenChange={setOpen}
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
