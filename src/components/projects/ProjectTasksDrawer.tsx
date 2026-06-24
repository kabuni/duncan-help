import { useEffect, useState, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ListChecks, Plus, CalendarIcon, User, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ProjectMember } from "@/hooks/useProjects";

interface PlanItemRow {
  id: string;
  chat_id: string;
  title: string;
  status: "suggested" | "accepted" | "done" | "promoted";
  assignee_profile_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
}

const UNASSIGNED = "__unassigned__";

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
  chats?: { id: string; title: string }[];
  onJumpToChat?: (chatId: string) => void;
}) {
  const [items, setItems] = useState<PlanItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_chat_plan_items" as any)
      .select("id, chat_id, title, status, assignee_profile_id, due_date, completed_at, created_at")
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

  async function patch(id: string, patch: Record<string, any>) {
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .update(patch)
      .eq("id", id);
    if (error) toast.error(error.message);
  }

  async function toggleDone(item: PlanItemRow) {
    if (item.status === "promoted") return;
    if (item.status === "done") {
      await patch(item.id, { status: "accepted", completed_at: null });
    } else {
      await patch(item.id, { status: "done", completed_at: new Date().toISOString() });
    }
  }

  async function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");

      let chatId: string | null = null;
      const { data: existingChat } = await supabase
        .from("project_chats")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      chatId = existingChat?.id ?? null;
      if (!chatId) {
        const { data: created, error: createErr } = await supabase
          .from("project_chats")
          .insert({ project_id: projectId, title: "Tasks", created_by: userId })
          .select("id")
          .single();
        if (createErr) throw createErr;
        chatId = created.id;
      }

      const { error } = await supabase
        .from("project_chat_plan_items" as any)
        .insert({
          project_id: projectId,
          chat_id: chatId,
          created_by: userId,
          title,
          status: "accepted",
        });
      if (error) throw error;
      setNewTitle("");
    } catch (e: any) {
      toast.error(e.message || "Failed to add task");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
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
                const isPromoted = it.status === "promoted";
                return (
                  <li key={it.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isDone}
                        onCheckedChange={() => toggleDone(it)}
                        className="h-3.5 w-3.5 mt-1 shrink-0"
                        disabled={isPromoted}
                      />
                      <span
                        className={cn(
                          "flex-1 text-sm whitespace-pre-wrap break-words leading-relaxed",
                          isDone ? "line-through text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {it.title}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pl-6">
                      {/* Owner */}
                      <Select
                        value={it.assignee_profile_id ?? UNASSIGNED}
                        onValueChange={(v) =>
                          patch(it.id, { assignee_profile_id: v === UNASSIGNED ? null : v })
                        }
                        disabled={isPromoted}
                      >
                        <SelectTrigger className="h-7 w-auto min-w-[8rem] text-xs gap-1.5 px-2">
                          {assignee ? (
                            <span className="flex items-center gap-1.5">
                              <Avatar className="h-4 w-4">
                                <AvatarImage src={assignee.avatar_url || undefined} />
                                <AvatarFallback className="text-[8px]">
                                  {(assignee.display_name || "?").slice(0, 1).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate max-w-[8rem]">{assignee.display_name || "Member"}</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <User className="h-3 w-3" />
                              Owner
                            </span>
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.display_name || "Member"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Deadline */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPromoted}
                            className={cn(
                              "h-7 text-xs gap-1.5 px-2 font-normal",
                              !it.due_date && "text-muted-foreground",
                            )}
                          >
                            <CalendarIcon className="h-3 w-3" />
                            {it.due_date ? `Due ${format(new Date(it.due_date), "d MMM")}` : "Deadline"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={it.due_date ? new Date(it.due_date) : undefined}
                            onSelect={(d) =>
                              patch(it.id, { due_date: d ? format(d, "yyyy-MM-dd") : null })
                            }
                            initialFocus
                            className={cn("p-3 pointer-events-auto")}
                          />
                          {it.due_date && (
                            <div className="border-t border-border p-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full h-7 text-xs"
                                onClick={() => patch(it.id, { due_date: null })}
                              >
                                Clear deadline
                              </Button>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>

                      {/* Completion */}
                      {it.completed_at && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-green-600" />
                          Done {format(new Date(it.completed_at), "d MMM")}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addTask();
          }}
          className="border-t border-border px-3 py-2 flex items-center gap-2"
        >
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a task…"
            className="h-8 text-sm"
            disabled={adding}
          />
          <Button type="submit" size="sm" className="h-8 px-2" disabled={adding || !newTitle.trim()}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
