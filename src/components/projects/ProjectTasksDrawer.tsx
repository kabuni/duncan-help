import { useEffect, useState, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

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
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2, ListChecks, Plus, CalendarIcon, CheckCircle2,
  Sparkles, Trash2, SlidersHorizontal, X, Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ProjectMember } from "@/hooks/useProjects";
import { ImportTasksFromNotesDialog } from "./ImportTasksFromNotesDialog";

interface PlanItemRow {
  id: string;
  chat_id: string;
  title: string;
  status: "suggested" | "accepted" | "done" | "promoted";
  assignee_profile_id: string | null;
  due_date: string | null;
  deadline: string | null;
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
  const [importOpen, setImportOpen] = useState(false);
  const [filterOwner, setFilterOwner] = useState<string | "all">("all");
  const [filterDue, setFilterDue] = useState<string>("all");
  const [filterDeadline, setFilterDeadline] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const isDone = it.status === "done" || it.status === "promoted";
      if (searchText.trim() && !it.title.toLowerCase().includes(searchText.trim().toLowerCase())) return false;
      if (filterOwner !== "all") {
        if (filterOwner === "__unassigned__") {
          if (it.assignee_profile_id) return false;
        } else if (it.assignee_profile_id !== filterOwner) {
          return false;
        }
      }
      if (filterDue === "overdue" && (isDone || !isPast(it.due_date))) return false;
      if (filterDue === "has" && !it.due_date) return false;
      if (filterDue === "none" && it.due_date) return false;
      if (filterDeadline === "overdue" && (isDone || !isPast(it.deadline))) return false;
      if (filterDeadline === "has" && !it.deadline) return false;
      if (filterDeadline === "none" && it.deadline) return false;
      return true;
    });
  }, [items, filterOwner, filterDue, filterDeadline, searchText]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const aDone = a.status === "done" || a.status === "promoted";
      const bDone = b.status === "done" || b.status === "promoted";
      if (aDone === bDone) return 0;
      return aDone ? 1 : -1;
    });
  }, [filteredItems]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_chat_plan_items" as any)
      .select("id, chat_id, title, status, assignee_profile_id, due_date, deadline, completed_at, created_at")
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
    // Optimistic update so the UI reflects the change immediately even if
    // realtime is slow or no row is returned.
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    const { data, error } = await supabase
      .from("project_chat_plan_items" as any)
      .update(patch)
      .eq("id", id)
      .select("id");
    if (error) {
      toast.error(error.message);
      load();
      return;
    }
    if (!data || data.length === 0) {
      toast.error("You don't have permission to update this task");
      load();
    }
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

  function isPast(dateStr: string | null) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    d.setHours(23, 59, 59, 999);
    return d < new Date();
  }

  async function deleteTask(id: string) {
    const prev = items;
    setItems((cur) => cur.filter((it) => it.id !== id));
    const { error } = await supabase
      .from("project_chat_plan_items" as any)
      .delete()
      .eq("id", id);
    if (error) {
      setItems(prev);
      toast.error(error.message);
    } else {
      toast.success("Task deleted");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl lg:max-w-3xl p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border pr-12">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Tasks — {projectName}
          </SheetTitle>
          <SheetDescription className="text-xs mt-0.5">
            {filteredItems.length} of {items.length} {items.length === 1 ? "task" : "tasks"}
            {(filterOwner !== "all" || filterDue !== "all" || filterDeadline !== "all" || searchText) && " · filtered"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Filter bar */}
          <div className="px-4 py-2 border-b border-border flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search tasks…"
                className="h-7 text-xs pl-7"
              />
            </div>

            <Select
              value={filterOwner}
              onValueChange={(v) => setFilterOwner(v)}
            >
              <SelectTrigger className="h-7 w-auto min-w-[7.5rem] text-xs gap-1 px-2">
                <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                {filterOwner === "all" ? "All owners" : filterOwner === UNASSIGNED ? "Unassigned" : (memberById.get(filterOwner)?.display_name || "Owner")}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name || "Member"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterDue} onValueChange={setFilterDue}>
              <SelectTrigger className="h-7 w-auto min-w-[7.5rem] text-xs gap-1 px-2">
                <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                {filterDue === "all" ? "Due date" : filterDue === "overdue" ? "Overdue" : filterDue === "has" ? "Has due" : "No due date"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="has">Has due date</SelectItem>
                <SelectItem value="none">No due date</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterDeadline} onValueChange={setFilterDeadline}>
              <SelectTrigger className="h-7 w-auto min-w-[7.5rem] text-xs gap-1 px-2">
                <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                {filterDeadline === "all" ? "Deadline" : filterDeadline === "overdue" ? "Overdue" : filterDeadline === "has" ? "Has deadline" : "No deadline"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="has">Has deadline</SelectItem>
                <SelectItem value="none">No deadline</SelectItem>
              </SelectContent>
            </Select>

            {(filterOwner !== "all" || filterDue !== "all" || filterDeadline !== "all" || searchText) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => {
                  setFilterOwner("all");
                  setFilterDue("all");
                  setFilterDeadline("all");
                  setSearchText("");
                }}
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}

            <div className="ml-auto">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={() => setImportOpen(true)}
              >
                <Sparkles className="h-3 w-3" />
                Import
              </Button>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-12 px-4">
              {items.length === 0 ? "No tasks yet." : "No tasks match your filters."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {sortedItems.map((it, idx) => {
                const assignee = it.assignee_profile_id ? memberById.get(it.assignee_profile_id) : null;
                const isDone = it.status === "done" || it.status === "promoted";
                const isPromoted = it.status === "promoted";
                const duePast = !isDone && isPast(it.due_date);
                const deadlinePast = !isDone && isPast(it.deadline);
                const showDoneHeader = isDone && (idx === 0 || !(sortedItems[idx - 1].status === "done" || sortedItems[idx - 1].status === "promoted"));
                return [
                  <li key={it.id} className={cn("px-4 py-3 space-y-2 group", deadlinePast && "bg-destructive/5")}>
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
                          isDone ? "line-through text-muted-foreground" : deadlinePast ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {it.title}
                      </span>
                      {!isPromoted && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                              aria-label="Delete task"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                              <AlertDialogDescription className="text-xs">
                                "{it.title}" will be permanently removed.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteTask(it.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
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
                        <SelectTrigger className="h-7 w-auto min-w-[10rem] text-xs gap-1.5 px-2">
                          {assignee ? (
                            <span className="truncate max-w-[12rem]">{assignee.display_name || "Member"}</span>
                          ) : (
                            <span className="text-muted-foreground">Owner</span>
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

                      {/* Due date */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPromoted}
                            className={cn(
                              "h-7 text-xs gap-1.5 px-2 font-normal",
                              !it.due_date && "text-muted-foreground",
                              duePast && "border-norman-warning text-norman-warning",
                            )}
                          >
                            <CalendarIcon className="h-3 w-3" />
                            {it.due_date ? `Due ${format(new Date(it.due_date), "d MMM")}` : "Due date"}
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
                                Clear due date
                              </Button>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>

                      {/* Deadline */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPromoted}
                            className={cn(
                              "h-7 text-xs gap-1.5 px-2 font-normal",
                              !it.deadline && "text-muted-foreground",
                              deadlinePast && "border-destructive text-destructive bg-destructive/5",
                            )}
                          >
                            <CalendarIcon className="h-3 w-3" />
                            {it.deadline ? `Deadline ${format(new Date(it.deadline), "d MMM")}` : "Deadline"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={it.deadline ? new Date(it.deadline) : undefined}
                            onSelect={(d) =>
                              patch(it.id, { deadline: d ? format(d, "yyyy-MM-dd") : null })
                            }
                            initialFocus
                            className={cn("p-3 pointer-events-auto")}
                          />
                          {it.deadline && (
                            <div className="border-t border-border p-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full h-7 text-xs"
                                onClick={() => patch(it.id, { deadline: null })}
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
      <ImportTasksFromNotesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
        members={members}
        onImported={load}
      />
    </Sheet>
  );
}
