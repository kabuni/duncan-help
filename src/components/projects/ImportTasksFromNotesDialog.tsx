import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, FileText, Mail, Search, ChevronLeft } from "lucide-react";
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

interface MeetingEmail {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

type Mode = "meetings" | "paste";

// Default Gemini / Google Meet notes query. Broad on purpose so we catch:
//  - Google Meet / Gemini auto-generated notes emails
//  - Forwarded / shared Gemini notes
//  - Anything that looks like meeting notes / recap / summary
const GEMINI_NOTES_QUERY = [
  'from:meetings-noreply@google.com',
  'from:notes-noreply@google.com',
  'from:noreply-meet@google.com',
  '"Gemini took notes"',
  '"took notes in"',
  '"Notes from"',
  '"Meeting notes"',
  '"meeting recap"',
  '"meeting summary"',
  'subject:"Notes:"',
  'subject:"Recap:"',
].join(' OR ');

// Extract a Google Docs file ID from an email body (HTML or text)
function extractDocId(html: string, text: string): string | null {
  const haystack = `${html || ""}\n${text || ""}`;
  const m = haystack.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDate(d: string) {
  try {
    return format(new Date(d), "d MMM, HH:mm");
  } catch {
    return d;
  }
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
  const [mode, setMode] = useState<Mode>("meetings");
  const [notes, setNotes] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [actions, setActions] = useState<PendingAction[]>([]);

  // Gmail browsing state
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [meetings, setMeetings] = useState<MeetingEmail[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState<string>("");
  const [loadingMeetingId, setLoadingMeetingId] = useState<string | null>(null);
  const [sourceSubject, setSourceSubject] = useState<string | null>(null);

  function reset() {
    setMode("meetings");
    setNotes("");
    setActions([]);
    setSearchQuery("");
    setActiveQuery("");
    setSourceSubject(null);
    setMeetings([]);
    setNextPageToken(null);
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

  function buildQuery(userQuery: string): string {
    const q = userQuery.trim();
    if (!q) return GEMINI_NOTES_QUERY;
    // If user typed a free-text search, broaden: search BOTH meeting-note emails
    // AND any email that matches the user's text. This way they can find any
    // meeting in their mailbox, not just Gemini auto-notes.
    return `(${GEMINI_NOTES_QUERY}) OR (${q})`;
  }

  async function fetchMeetings(userQuery: string, append = false) {
    if (append) setLoadingMore(true);
    else setLoadingMeetings(true);
    try {
      const q = buildQuery(userQuery);
      setActiveQuery(userQuery);
      const { data, error } = await supabase.functions.invoke("gmail-api", {
        body: {
          action: "search",
          query: q,
          maxResults: append ? 10 : 6,
          pageToken: append ? nextPageToken ?? undefined : undefined,
        },
      });
      if (error) throw error;
      const incoming: MeetingEmail[] = data?.emails ?? [];
      setMeetings((prev) => (append ? [...prev, ...incoming] : incoming));
      setNextPageToken(data?.nextPageToken ?? null);
    } catch (e: any) {
      const msg = e.message || "Failed to load meetings";
      if (/not connected|reconnect|token/i.test(msg)) {
        setGmailConnected(false);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoadingMeetings(false);
      setLoadingMore(false);
    }
  }

  // On open, check Gmail status and prefetch meetings
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("gmail-api", {
          body: { action: "status" },
        });
        if (cancelled) return;
        if (error || !data?.connected) {
          setGmailConnected(false);
          return;
        }
        setGmailConnected(true);
        fetchMeetings("");
      } catch {
        if (!cancelled) setGmailConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function pickMeeting(m: MeetingEmail) {
    setLoadingMeetingId(m.id);
    setActions([]);
    try {
      const { data: emailData, error: readErr } = await supabase.functions.invoke("gmail-api", {
        body: { action: "read", messageId: m.id },
      });
      if (readErr) throw new Error(readErr.message || "Gmail read failed");

      const htmlBody: string = emailData?.htmlBody || "";
      const textBody: string = emailData?.textBody || "";
      const snippet: string = emailData?.snippet || "";

      // 1) If the email links a Google Doc (Gemini's notes doc), fetch the full
      //    doc text from Drive — that's where the real notes live.
      let notesText = "";
      const docId = extractDocId(htmlBody, textBody);
      if (docId) {
        try {
          const { data: docData, error: docErr } = await supabase.functions.invoke(
            "google-drive-api",
            {
              body: {
                action: "get_content",
                fileId: docId,
                mimeType: "application/vnd.google-apps.document",
              },
            },
          );
          if (docErr) throw new Error(docErr.message || "Drive read failed");
          if (docData?.content && typeof docData.content === "string") {
            notesText = docData.content;
          }
        } catch (driveErr: any) {
          // Fall through to email body — surface a hint in console
          console.warn("Drive doc fetch failed, falling back to email body:", driveErr);
        }
      }

      // 2) Fall back to the email body itself.
      if (notesText.trim().length < 20) {
        notesText = textBody || (htmlBody ? stripHtml(htmlBody) : "") || snippet;
      }

      if (notesText.trim().length < 20) {
        toast.error(
          docId
            ? "Found a notes doc but couldn't read it. Make sure Google Drive is connected with access to this doc."
            : "This email doesn't contain enough notes text to extract actions.",
        );
        return;
      }

      setSourceSubject(m.subject || "Meeting notes");
      await extractFrom(notesText);
    } catch (e: any) {
      toast.error(e.message || "Failed to read meeting notes");
    } finally {
      setLoadingMeetingId(null);
    }
  }


  async function extractFrom(text: string) {
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-actions-from-notes", {
        body: {
          notes: text,
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

  async function extractFromPaste() {
    if (notes.trim().length < 10) {
      toast.error("Paste your meeting notes first");
      return;
    }
    setSourceSubject(null);
    await extractFrom(notes);
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

  const showingReview = actions.length > 0;

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
            {showingReview
              ? sourceSubject
                ? `Action items from "${sourceSubject}". Review and add to your task list.`
                : "Review the action items Duncan extracted, then add them to your task list."
              : mode === "meetings"
                ? "Pick a Gemini meeting from your Gmail. Duncan will read the notes and pull out the action items."
                : "Paste meeting notes (Gemini, Otter, or any text). Duncan will extract the action items."}
          </DialogDescription>
        </DialogHeader>

        {showingReview ? (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            <p className="text-xs text-muted-foreground px-1">
              Found {actions.length} action{actions.length === 1 ? "" : "s"}. Uncheck any you don't want to add.
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
        ) : mode === "meetings" ? (
          <div className="space-y-3">
            {gmailConnected === false ? (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                Gmail isn't connected. Connect Gmail in Settings → Gmail to pull in your Gemini meeting notes, or paste them manually.
                <div className="mt-3">
                  <Button size="sm" variant="outline" onClick={() => setMode("paste")}>
                    Paste notes instead
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    fetchMeetings(searchQuery);
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search meetings (e.g. project, attendee, keyword)…"
                      className="pl-8 h-9 text-sm"
                      disabled={loadingMeetings}
                    />
                  </div>
                  <Button type="submit" size="sm" variant="outline" disabled={loadingMeetings}>
                    {loadingMeetings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
                  </Button>
                </form>

                <div className="border border-border rounded-md divide-y divide-border max-h-[360px] overflow-y-auto">
                  {loadingMeetings && meetings.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading meetings…
                    </div>
                  ) : meetings.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      No Gemini meeting notes found{searchQuery ? " for that search" : ""}.
                    </div>
                  ) : (
                    meetings.map((m) => {
                      const isLoading = loadingMeetingId === m.id;
                      const disabled = !!loadingMeetingId || extracting;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => pickMeeting(m)}
                          disabled={disabled}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-2.5"
                        >
                          <Mail className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{m.subject || "(no subject)"}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {safeDate(m.date)} · {m.from.replace(/<.*>/, "").trim()}
                            </p>
                            {m.snippet && (
                              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                                {m.snippet}
                              </p>
                            )}
                          </div>
                          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 mt-1" />}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex justify-between items-center text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    onClick={() => setMode("paste")}
                  >
                    <FileText className="h-3.5 w-3.5" /> Paste notes instead
                  </button>
                  {extracting && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Extracting action items…
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste meeting notes here…"
              className="min-h-[220px] text-sm"
              disabled={extracting}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                {gmailConnected !== false && (
                  <button
                    type="button"
                    onClick={() => setMode("meetings")}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Back to meetings
                  </button>
                )}
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
              </div>
              <Button onClick={extractFromPaste} disabled={extracting || notes.trim().length < 10} size="sm">
                {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Extract action items
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {showingReview && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActions([]);
                  setSourceSubject(null);
                }}
                disabled={importing}
              >
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
