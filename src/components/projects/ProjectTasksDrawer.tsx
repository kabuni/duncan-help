import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ListChecks, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import type { ProjectMember } from "@/hooks/useProjects";

interface PlanItemRow {
  id: string;
  chat_id: string;
  title: string;
  group_title: string | null;
  status: "suggested" | "accepted" | "done" | "promoted";
  assignee_profile_id: string | null;
  due_date: string | null;
  created_at: string;
  promoted_card_id: string | null;
}

interface ChatLite {
  id: string;
  title: string;
}

export function ProjectTasksDrawer({
  open,
  onOpenChange,
  projectId,
  projectName,
  members,
  chats,
  onJumpToChat,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  projectName: string;
  members: ProjectMember[];
  chats: ChatLite[];
  onJumpToChat: (chatId: string) => void;
}) {
  const [items, setItems] = useState<PlanItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_chat_plan_items" as any)
      .select("id, chat_id, title, group_title, status, assignee_profile_id, due_date, created_at, promoted_card_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (!error) setItems((data as any[]) as PlanItemRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    load();
    const channel = supabase
      .channel(`project_tasks_drawer:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_chat_plan_items", filter: `project_id=eq.${projectId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, projectId, load]);

  const memberById = useMemo(() => {
    const m = new Map<string, ProjectMember>();
    members.forEach((mem) => m.set(mem.user_id, mem));
    return m;
  }, [members]);

  const chatById = useMemo(() => {
    const m = new Map<string, ChatLite>();
    chats.forEach((c) => m.set(c.id, c));
    return m;
  }, [chats]);

  const open_items = items.filter((i) => i.status !== "promoted" && i.status !== "done");
  const completed = items.filter((i) => i.status === "done");
  const promoted = items.filter((i) => i.status === "promoted");

  async function toggleDone(item: PlanItemRow) {
    const next = item.status === "done" ? "accepted" : "done";
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .update({ status: next })
      .eq("id", item.id);
    if (error) toast.error(error.message);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Tasks — {projectName}
          </SheetTitle>
          <SheetDescription className="text-xs">
            All to-dos across every chat in this project. Use the planning checklist in each chat to add new ones.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-12">
              No tasks yet. Open a chat and add items to the Planning checklist.
            </p>
          ) : (
            <>
              <Section
                title="Open"
                count={open_items.length}
                items={open_items}
                memberById={memberById}
                chatById={chatById}
                onToggleDone={toggleDone}
                onJumpToChat={(id) => {
                  onJumpToChat(id);
                  onOpenChange(false);
                }}
              />
              {completed.length > 0 && (
                <Section
                  title="Completed"
                  count={completed.length}
                  items={completed}
                  memberById={memberById}
                  chatById={chatById}
                  onToggleDone={toggleDone}
                  onJumpToChat={(id) => {
                    onJumpToChat(id);
                    onOpenChange(false);
                  }}
                  muted
                />
              )}
              {promoted.length > 0 && (
                <Section
                  title="Sent to Workstreams"
                  count={promoted.length}
                  items={promoted}
                  memberById={memberById}
                  chatById={chatById}
                  onToggleDone={toggleDone}
                  onJumpToChat={(id) => {
                    onJumpToChat(id);
                    onOpenChange(false);
                  }}
                  muted
                />
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  count,
  items,
  memberById,
  chatById,
  onToggleDone,
  onJumpToChat,
  muted,
}: {
  title: string;
  count: number;
  items: PlanItemRow[];
  memberById: Map<string, ProjectMember>;
  chatById: Map<string, ChatLite>;
  onToggleDone: (i: PlanItemRow) => void;
  onJumpToChat: (chatId: string) => void;
  muted?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{count}</Badge>
      </div>
      <div className="space-y-1">
        {items.map((it) => {
          const assignee = it.assignee_profile_id ? memberById.get(it.assignee_profile_id) : null;
          const chat = chatById.get(it.chat_id);
          return (
            <div
              key={it.id}
              className={`group flex items-start gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 ${muted ? "opacity-70" : ""}`}
            >
              <Checkbox
                checked={it.status === "done"}
                onCheckedChange={() => onToggleDone(it)}
                className="mt-0.5 h-3.5 w-3.5"
                disabled={it.status === "promoted"}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-xs text-foreground leading-relaxed ${it.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                  {it.title}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                  {it.group_title && <span className="font-medium">{it.group_title}</span>}
                  {it.due_date && <span>Due {new Date(it.due_date).toLocaleDateString()}</span>}
                  {chat && (
                    <button
                      onClick={() => onJumpToChat(it.chat_id)}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                      title="Jump to chat"
                    >
                      <MessageSquare className="h-2.5 w-2.5" />
                      {chat.title}
                    </button>
                  )}
                  {it.status === "promoted" && it.promoted_card_id && (
                    <a
                      href={`/workstreams?card=${it.promoted_card_id}`}
                      className="text-primary hover:underline"
                    >
                      open card
                    </a>
                  )}
                </div>
              </div>
              {assignee && (
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarImage src={assignee.avatar_url || undefined} alt={assignee.display_name || ""} />
                  <AvatarFallback className="text-[10px]">
                    {(assignee.display_name || "?").slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
