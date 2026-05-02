import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronRight,
  ListChecks,
  Plus,
  Send,
  Trash2,
  X,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PromoteToWorkstreamDialog } from "./PromoteToWorkstreamDialog";

export interface PlanItem {
  id: string;
  chat_id: string;
  project_id: string;
  group_title: string | null;
  title: string;
  notes: string | null;
  due_date: string | null;
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
}: {
  chatId: string;
  projectId: string;
  chatTitle?: string;
}) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);

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
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .update({ status: next })
      .eq("id", item.id);
    if (error) toast.error(error.message);
  }

  async function acceptItem(item: PlanItem) {
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .update({ status: "accepted" })
      .eq("id", item.id);
    if (error) toast.error(error.message);
  }

  async function removeItem(id: string) {
    const { error } = await supabase.from("project_chat_plan_items" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  async function updateTitle(item: PlanItem, title: string) {
    const t = title.trim();
    if (!t || t === item.title) return;
    await supabase.from("project_chat_plan_items" as any).update({ title: t }).eq("id", item.id);
  }

  async function updateGroup(item: PlanItem, group: string) {
    const g = group.trim() || null;
    await supabase.from("project_chat_plan_items" as any).update({ group_title: g }).eq("id", item.id);
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
        <div className="ml-auto">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            disabled={totalOpen === 0}
            onClick={() => setPromoteOpen(true)}
          >
            <Send className="h-3 w-3 mr-1" />
            Send to Workstreams
          </Button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {loading ? (
            <p className="text-xs text-muted-foreground italic">Loading…</p>
          ) : open_items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Capture next steps as you brainstorm. Click <strong>Send to Workstreams</strong> when you're ready to turn them into cards and tasks.
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
                      onToggleDone={toggleDone}
                      onRemove={removeItem}
                      onUpdateTitle={updateTitle}
                      onUpdateGroup={updateGroup}
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
                      onToggleDone={toggleDone}
                      onRemove={removeItem}
                      onUpdateTitle={updateTitle}
                      onUpdateGroup={updateGroup}
                    />
                  ))}
                </div>
              ))}
            </>
          )}

          {/* Quick-add */}
          <div className="flex gap-1.5 pt-1">
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
              className="h-7 text-xs flex-1"
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
        defaultCardTitle={chatTitle}
        itemCount={totalOpen}
      />
    </div>
  );
}

function PlanRow({
  item,
  onToggleDone,
  onRemove,
  onUpdateTitle,
  onUpdateGroup,
  onAccept,
}: {
  item: PlanItem;
  onToggleDone: (item: PlanItem) => void;
  onRemove: (id: string) => void;
  onUpdateTitle: (item: PlanItem, title: string) => void;
  onUpdateGroup: (item: PlanItem, group: string) => void;
  onAccept?: (item: PlanItem) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [draftGroup, setDraftGroup] = useState(item.group_title || "");

  useEffect(() => setDraftTitle(item.title), [item.title]);
  useEffect(() => setDraftGroup(item.group_title || ""), [item.group_title]);

  return (
    <div className="flex items-center gap-1.5 group">
      <Checkbox
        checked={item.status === "done"}
        onCheckedChange={() => onToggleDone(item)}
        className="h-3.5 w-3.5"
      />
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
