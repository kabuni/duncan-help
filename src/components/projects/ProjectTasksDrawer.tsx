import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ListChecks } from "lucide-react";
import { toast } from "sonner";
import type { ProjectMember } from "@/hooks/useProjects";

interface PlanItemRow {
  id: string;
  chat_id: string;
  title: string;
  status: "suggested" | "accepted" | "done" | "promoted";
  assignee_profile_id: string | null;
  due_date: string | null;
  created_at: string;
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  projectName: string;
  members: ProjectMember[];
  chats?: ChatLite[];
  onJumpToChat?: (chatId: string) => void;
}) {
  const [items, setItems] = useState<PlanItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_chat_plan_items" as any)
      .select("id, chat_id, title, status, assignee_profile_id, due_date, created_at")
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

  async function toggleDone(item: PlanItemRow) {
    if (item.status === "promoted") return;
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
            {items.length} {items.length === 1 ? "task" : "tasks"} in this project
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-12 px-4">
              No tasks yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((it) => {
                const assignee = it.assignee_profile_id ? memberById.get(it.assignee_profile_id) : null;
                const isDone = it.status === "done" || it.status === "promoted";
                return (
                  <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                    <Checkbox
                      checked={isDone}
                      onCheckedChange={() => toggleDone(it)}
                      className="h-3.5 w-3.5 mt-1 shrink-0"
                      disabled={it.status === "promoted"}
                    />
                    <span
                      className={`flex-1 text-sm whitespace-pre-wrap break-words leading-relaxed ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}
                    >
                      {it.title}
                    </span>
                    {assignee && (
                      <Avatar className="h-5 w-5 shrink-0">
                        <AvatarImage src={assignee.avatar_url || undefined} alt={assignee.display_name || ""} />
                        <AvatarFallback className="text-[9px]">
                          {(assignee.display_name || "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
