import { useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, FileText } from "lucide-react";
import { toast } from "sonner";
import type { ProjectMember } from "@/hooks/useProjects";

interface ExtractedAction {
  title: string;
  assignee_hint?: string | null;
  due_date?: string | null;
}

interface PendingAction extends ExtractedAction {
  include: boolean;
  resolved_assignee_id: string | null;
}

export function ImportTasksFromNotesDialog({
  open,
  onOpenChange,
  projectId,
  members,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  members: ProjectMember[];
  onImported: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [actions, setActions] = useState<PendingAction[]>([]);

  function reset() {
    setNotes("");
    setActions([]);
  }

  function resolveAssignee(hint?: string | null): string | null {
    if (!hint) return null;
    const h = hint.trim().toLowerCase();
    if (!h) return null;
    const match = members.find((m) => {
      const name = (m.display_name || "").toLowerCase();
      return name === h || name.startsWith(h) || h.startsWith(name.split(" ")[0] || "");
    });
    return match?.user_id ?? null;
  }

  async function extract() {
    if (notes.trim().length < 10) {
      toast.error("Paste your meeting notes first");
      return;
    }
    setExtracting(true);
    setActions([]);
    try {
      const { data, error } = await supabase.functions.invoke("extract-actions-from-notes", {
        body: {
          notes,
          members: members.map((m) => ({ user_id: m.user_id, display_name: m.display_name })),
        },
      });
      if (error) throw error;
      const raw: ExtractedAction[] = data?.actions ?? [];
      if (raw.length === 0) {
        toast.info("No action items found in those notes");
      }
      setActions(
        raw.map((a) => ({
          ...a,
          include: true,
          resolved_assignee_id: resolveAssignee(a.assignee_hint),
        })),
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to extract actions");
    } finally {
      setExtracting(false);
    }
  }

  async function importSelected() {
    const chosen = actions.filter((a) => a.include);
    if (chosen.length === 0) {
      toast.error("Select at least one task");
      return;
    }
    setImporting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");

      // Find or create a chat to attach the items to.
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
        const { data: created, error: cErr } = await supabase
          .from("project_chats")
          .insert({ project_id: projectId, title: "Tasks" })
          .select("id")
          .single();
        if (cErr) throw cErr;
        chatId = created.id;
      }

      const rows = chosen.map((a) => ({
        project_id: projectId,
        chat_id: chatId!,
        created_by: userId,
        title: a.title,
        status: "accepted",
        assignee_profile_id: a.resolved_assignee_id,
        due_date: a.due_date || null,
      }));

      const { error } = await supabase.from("project_chat_plan_items" as any).insert(rows);
      if (error) throw error;

      toast.success(`Added ${rows.length} task${rows.length === 1 ? "" : "s"}`);
      reset();
      onOpenChange(false);
      onImported();
    } catch (e: any) {
      toast.error(e.message || "Failed to import tasks");
    } finally {
      setImporting(false);
    }
  }

  async function handleFile(file: File) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
      const text = await file.text();
      setNotes((prev) => (prev ? prev + "\n\n" + text : text));
    } else {
      toast.error("Only .txt / .md files can be imported directly. For .docx or PDF, paste the text.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Import tasks from notes
          </DialogTitle>
          <DialogDescription className="text-xs">
            Paste your Gemini meeting notes (or any text). Duncan will pull out the action items so you can review and add them in one go.
          </DialogDescription>
        </DialogHeader>

        {actions.length === 0 ? (
          <div className="space-y-3">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste meeting notes here…"
              className="min-h-[220px] text-sm"
              disabled={extracting}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span>Upload .txt / .md</span>
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </label>
              <Button onClick={extract} disabled={extracting || notes.trim().length < 10} size="sm">
                {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Extract action items
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            <p className="text-xs text-muted-foreground px-1">
              Review the {actions.length} action{actions.length === 1 ? "" : "s"} found. Uncheck any you don't want to add.
            </p>
            <ul className="divide-y divide-border border border-border rounded-md">
              {actions.map((a, idx) => {
                const assignee = a.resolved_assignee_id
                  ? members.find((m) => m.user_id === a.resolved_assignee_id)
                  : null;
                return (
                  <li key={idx} className="flex items-start gap-3 px-3 py-2.5">
                    <Checkbox
                      checked={a.include}
                      onCheckedChange={(v) =>
                        setActions((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, include: !!v } : p)),
                        )
                      }
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed">{a.title}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                        {assignee ? (
                          <span>Owner: {assignee.display_name}</span>
                        ) : a.assignee_hint ? (
                          <span className="italic">Mentioned: {a.assignee_hint} (unmatched)</span>
                        ) : null}
                        {a.due_date && <span>Due {format(new Date(a.due_date), "d MMM yyyy")}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <DialogFooter>
          {actions.length > 0 && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setActions([])} disabled={importing}>
                Back
              </Button>
              <Button size="sm" onClick={importSelected} disabled={importing}>
                {importing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Add {actions.filter((a) => a.include).length} task
                {actions.filter((a) => a.include).length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
