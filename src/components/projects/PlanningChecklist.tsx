import { useEffect, useState, useCallback, useMemo, forwardRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronDown,
  ChevronRight,
  ListChecks,
  Plus,
  Send,
  Trash2,
  Sparkles,
  UserCircle2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ProjectMember } from "@/hooks/useProjects";
import { PromoteToWorkstreamDialog } from "./PromoteToWorkstreamDialog";

export interface PlanItem {
  id: string;
  chat_id: string;
  project_id: string;
  group_title: string | null;
  title: string;
  notes: string | null;
  due_date: string | null;
  deadline: string | null;
  assignee_profile_id: string | null;
  status: "suggested" | "accepted" | "done" | "promoted";
  position: number;
  promoted_card_id: string | null;
  promoted_task_id: string | null;
  created_by: string;
  created_at: string;
}

export function PlanningChecklist({
  chatId,
  projectId,
  chatTitle,
  projectName,
  members,
  currentUserId,
}: {
  chatId: string;
  projectId: string;
  chatTitle?: string;
  projectName?: string;
  members: ProjectMember[];
  currentUserId: string | null;
}) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [newAssignee, setNewAssignee] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);

  // Default new-item assignee to current user
  useEffect(() => {
    if (!newAssignee && currentUserId) setNewAssignee(currentUserId);
  }, [currentUserId, newAssignee]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("project_chat_plan_items" as any)
      .select("*")
      .eq("chat_id", chatId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error) setItems((data as any[]) as PlanItem[]);
    setLoading(false);
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    load();
    const channel = supabase
      .channel(`plan_items:${chatId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_chat_plan_items", filter: `chat_id=eq.${chatId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, load]);

  const open_items = useMemo(() => items.filter((i) => i.status !== "promoted"), [items]);
  const accepted = useMemo(() => open_items.filter((i) => i.status === "accepted" || i.status === "done"), [open_items]);
  const suggested = useMemo(() => open_items.filter((i) => i.status === "suggested"), [open_items]);
  const groupedAccepted = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const it of accepted) {
      const key = it.group_title?.trim() || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries());
  }, [accepted]);

  async function addItem() {
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Not signed in");
      setAdding(false);
      return;
    }
    const maxPos = items.reduce((m, i) => Math.max(m, i.position), 0);
    const { error } = await supabase.from("project_chat_plan_items" as any).insert({
      chat_id: chatId,
      project_id: projectId,
      created_by: user.id,
      title,
      group_title: newGroup.trim() || null,
      assignee_profile_id: newAssignee || user.id,
      status: "accepted",
      position: maxPos + 1,
    });
    setAdding(false);
    if (error) {
      toast.error(`Couldn't add item: ${error.message}`);
      return;
    }
    setNewTitle("");
  }

  async function toggleDone(item: PlanItem) {
    const next = item.status === "done" ? "accepted" : "done";
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next as PlanItem["status"] } : i)));
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .update({ status: next })
      .eq("id", item.id);
    if (error) {
      toast.error(`Couldn't update: ${error.message}`);
      // Revert
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)));
    }
  }

  async function acceptItem(item: PlanItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "accepted" } : i)));
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .update({ status: "accepted", assignee_profile_id: item.assignee_profile_id || currentUserId })
      .eq("id", item.id);
    if (error) {
      toast.error(`Couldn't accept: ${error.message}`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)));
    } else {
      toast.success("Added to your task list");
    }
  }

  async function removeItem(id: string) {
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    const { error } = await supabase.from("project_chat_plan_items" as any).delete().eq("id", id);
    if (error) {
      toast.error(`Couldn't remove: ${error.message}`);
      setItems(prev);
    }
  }

  async function updateTitle(item: PlanItem, title: string) {
    const t = title.trim();
    if (!t || t === item.title) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, title: t } : i)));
    const { error } = await supabase.from("project_chat_plan_items" as any).update({ title: t }).eq("id", item.id);
    if (error) {
      toast.error(`Couldn't rename: ${error.message}`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, title: item.title } : i)));
    }
  }

  async function updateGroup(item: PlanItem, group: string) {
    const g = group.trim() || null;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, group_title: g } : i)));
    const { error } = await supabase.from("project_chat_plan_items" as any).update({ group_title: g }).eq("id", item.id);
    if (error) {
      toast.error(`Couldn't update group: ${error.message}`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, group_title: item.group_title } : i)));
    }
  }

  async function updateAssignee(item: PlanItem, userId: string | null) {
    if (item.assignee_profile_id === userId) return;
    // Optimistic update
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, assignee_profile_id: userId } : i)));
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .update({ assignee_profile_id: userId })
      .eq("id", item.id);
    if (error) {
      console.error("Failed to update assignee:", error);
      toast.error(`Couldn't assign: ${error.message}`);
      // Revert
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, assignee_profile_id: item.assignee_profile_id } : i)));
      return;
    }
    if (userId) {
      const member = members.find((m) => m.user_id === userId);
      toast.success(`Assigned to ${member?.display_name || "team member"}`);
    } else {
      toast.success("Unassigned");
    }
  }

  const totalOpen = accepted.length;

  return (
    <div className="border-b border-border bg-muted/30">
      <div className="px-3 py-2 flex items-center gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <ListChecks className="h-3.5 w-3.5" />
          Planning checklist
          {totalOpen > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 text-primary px-1 text-[10px] font-medium">
              {totalOpen}
            </span>
          )}
          {suggested.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              <Sparkles className="h-3 w-3" /> {suggested.length} suggested
            </span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden sm:inline text-[10px] text-muted-foreground">
            Saved to project tasks
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={totalOpen === 0}
            onClick={() => setPromoteOpen(true)}
            title="Optional: also create workstream cards from these tasks"
          >
            <Send className="h-3 w-3 mr-1" />
            Also send to Workstreams
          </Button>
        </div>
      </div>

      {open && (
        <div>
        <div className="px-3 pt-2 pb-2 space-y-2 max-h-[40vh] overflow-y-auto overscroll-contain">
          {loading ? (
            <p className="text-xs text-muted-foreground italic">Loading…</p>
          ) : open_items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Capture next steps as you brainstorm. Items are saved to this project's <strong>Tasks</strong> tab automatically. Sending to Workstreams is optional — only do it when you want company-wide kanban cards.
            </p>
          ) : (
            <>
              {/* Suggested by Duncan */}
              {suggested.length > 0 && (
                <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-2 space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Suggested by Duncan — accept to keep
                  </div>
                  {suggested.map((it) => (
                    <PlanRow
                      key={it.id}
                      item={it}
                      members={members}
                      onToggleDone={toggleDone}
                      onRemove={removeItem}
                      onUpdateTitle={updateTitle}
                      onUpdateGroup={updateGroup}
                      onUpdateAssignee={updateAssignee}
                      onAccept={acceptItem}
                    />
                  ))}
                </div>
              )}

              {/* Accepted items, grouped by group_title */}
              {groupedAccepted.map(([group, list]) => (
                <div key={group || "ungrouped"} className="space-y-1">
                  {group && (
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pt-1">
                      {group}
                    </div>
                  )}
                  {list.map((it) => (
                    <PlanRow
                      key={it.id}
                      item={it}
                      members={members}
                      onToggleDone={toggleDone}
                      onRemove={removeItem}
                      onUpdateTitle={updateTitle}
                      onUpdateGroup={updateGroup}
                      onUpdateAssignee={updateAssignee}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

          {/* Quick-add */}
          <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-2 border-t border-border/50">
            <Input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Group (optional)"
              className="h-7 text-xs w-32"
            />
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addItem();
                }
              }}
              placeholder="Add a to-do…"
              className="h-7 text-xs flex-1 min-w-[140px]"
            />
            <AssigneePicker
              members={members}
              value={newAssignee}
              onChange={setNewAssignee}
            />
            <Button size="sm" className="h-7 text-xs" onClick={addItem} disabled={adding || !newTitle.trim()}>
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
        </div>
      )}

      <PromoteToWorkstreamDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        chatId={chatId}
        projectId={projectId}
        defaultCardTitle={projectName || chatTitle}
        itemCount={totalOpen}
      />
    </div>
  );
}

function PlanRow({
  item,
  members,
  onToggleDone,
  onRemove,
  onUpdateTitle,
  onUpdateGroup,
  onUpdateAssignee,
  onAccept,
}: {
  item: PlanItem;
  members: ProjectMember[];
  onToggleDone: (item: PlanItem) => void;
  onRemove: (id: string) => void;
  onUpdateTitle: (item: PlanItem, title: string) => void;
  onUpdateGroup: (item: PlanItem, group: string) => void;
  onUpdateAssignee: (item: PlanItem, userId: string | null) => void;
  onAccept?: (item: PlanItem) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [draftGroup, setDraftGroup] = useState(item.group_title || "");

  useEffect(() => setDraftTitle(item.title), [item.title]);
  useEffect(() => setDraftGroup(item.group_title || ""), [item.group_title]);

  return (
    <div className="flex items-center gap-1.5 group">
      <label
        className="shrink-0 inline-flex items-center justify-center p-1.5 -m-1 rounded cursor-pointer hover:bg-muted/60 active:bg-muted touch-manipulation"
        title={item.status === "done" ? "Mark as not done" : "Mark as done"}
        onClick={(e) => {
          // Ensure tap toggles even if the checkbox button doesn't receive the event
          e.preventDefault();
          e.stopPropagation();
          onToggleDone(item);
        }}
      >
        <Checkbox
          checked={item.status === "done"}
          onCheckedChange={() => onToggleDone(item)}
          className="h-4 w-4 pointer-events-none"
          tabIndex={-1}
        />
      </label>
      <Input
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        onBlur={() => onUpdateTitle(item, draftTitle)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "h-6 text-xs flex-1 border-0 bg-transparent px-1 focus-visible:ring-1 focus-visible:bg-background",
          item.status === "done" && "line-through text-muted-foreground",
        )}
      />
      <Input
        value={draftGroup}
        onChange={(e) => setDraftGroup(e.target.value)}
        onBlur={() => onUpdateGroup(item, draftGroup)}
        placeholder="group"
        className="h-6 text-[11px] w-24 border-0 bg-transparent px-1 text-muted-foreground focus-visible:ring-1 focus-visible:bg-background opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      />
      <AssigneePicker
        members={members}
        value={item.assignee_profile_id}
        onChange={(uid) => onUpdateAssignee(item, uid)}
      />
      {onAccept && (
        <button
          onClick={() => onAccept(item)}
          className="text-emerald-600 hover:bg-emerald-500/10 rounded p-1 text-[10px]"
          title="Accept suggestion"
        >
          Accept
        </button>
      )}
      <button
        onClick={() => onRemove(item.id)}
        className="text-muted-foreground hover:text-destructive rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

const AssigneePicker = forwardRef<
  HTMLButtonElement,
  {
    members: ProjectMember[];
    value: string | null;
    onChange: (userId: string | null) => void;
    compact?: boolean;
  }
>(function AssigneePicker({ members, value, onChange, compact }, _ref) {
  const selected = value ? members.find((m) => m.user_id === value) : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 rounded-md border border-transparent hover:border-border hover:bg-background transition-colors",
            compact ? "h-6 px-1" : "h-7 px-1.5",
          )}
          title={selected?.display_name || "Assign"}
        >
          {selected ? (
            <Avatar className={compact ? "h-5 w-5" : "h-5 w-5"}>
              <AvatarImage src={selected.avatar_url || undefined} alt={selected.display_name || ""} />
              <AvatarFallback className="text-[9px]">
                {(selected.display_name || "?").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ) : (
            <UserCircle2 className="h-4 w-4 text-muted-foreground" />
          )}
          {!compact && (
            <span className="text-[11px] text-muted-foreground max-w-[80px] truncate">
              {selected?.display_name || "Assign"}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          <button
            onClick={() => onChange(null)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-secondary/60 text-left"
          >
            <UserCircle2 className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-muted-foreground">Unassigned</span>
            {!value && <Check className="h-3 w-3 text-primary" />}
          </button>
          {members.map((m) => (
            <button
              key={m.user_id}
              onClick={() => onChange(m.user_id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-secondary/60 text-left"
            >
              <Avatar className="h-5 w-5">
                <AvatarImage src={m.avatar_url || undefined} alt={m.display_name || ""} />
                <AvatarFallback className="text-[9px]">
                  {(m.display_name || "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate">{m.display_name || "Unnamed"}</span>
              {value === m.user_id && <Check className="h-3 w-3 text-primary" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});
