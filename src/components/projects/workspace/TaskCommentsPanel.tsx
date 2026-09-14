import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTaskComments, useAddTaskComment, type ProjectTask } from "@/hooks/useProjectWork";
import { formatDay, EmptyLine } from "./shared";

/** Right-side panel holding one task's conversation. No separate page. */
export function TaskCommentsPanel({
  task, onOpenChange,
}: {
  task: ProjectTask | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: comments = [], isLoading } = useTaskComments(task?.id ?? null);
  const add = useAddTaskComment(task?.id ?? null);
  const [draft, setDraft] = useState("");

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    await add.mutateAsync(text);
    setDraft("");
  };

  return (
    <Sheet open={!!task} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0">
        <SheetHeader className="px-6 pt-6 pb-4 text-left border-b border-border">
          <SheetTitle className="text-base leading-snug">{task?.title}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {task?.assignee_name || "Unassigned"}
            {task?.due_date ? ` · Due ${formatDay(task.due_date)}` : ""}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : comments.length === 0 ? (
            <EmptyLine>No comments yet. Start the conversation below.</EmptyLine>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">{c.author_name || "Someone"}</span>
                  <span className="text-xs text-muted-foreground">{formatDay(c.created_at)}</span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-6">{c.content}</p>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border p-4 space-y-2">
          <Textarea
            rows={3}
            placeholder="Add a comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5" onClick={submit} disabled={!draft.trim() || add.isPending}>
              {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Comment
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
