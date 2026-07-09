import { useEffect, useState } from "react";
import { Loader2, Trash2, Lightbulb, Paperclip, Download, Sparkles, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface Attachment {
  id: string;
  storage_path: string;
  file_name: string;
  size_bytes: number | null;
  mime_type: string | null;
}

interface FeatureRequest {
  id: string;
  user_email: string | null;
  title: string;
  description: string;
  use_case: string | null;
  priority: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  triage_status: string | null;
  clarification_round: number | null;
  refined_title: string | null;
  problem_statement: string | null;
  proposed_solution: string | null;
  acceptance_criteria: string | null;
  category: string | null;
  priority_band: string | null;
  effort_band: string | null;
  rice_score: number | null;
  workstream_card_id: string | null;
  attachments?: Attachment[];
}

const statusOptions = ["new", "under_review", "planned", "in_progress", "completed", "declined"];

export default function FeatureRequestsAdmin() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feature_requests")
      .select("*, attachments:feature_request_attachments(id, storage_path, file_name, size_bytes, mime_type)")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRequests((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("feature_requests").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this feature request?")) return;
    const { error } = await supabase.from("feature_requests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    toast.success("Deleted");
  };

  const rerunTriage = async (id: string) => {
    toast.info("Re-running Duncan…");
    const { error } = await supabase.functions.invoke("feature-request-agent", {
      body: { feature_request_id: id },
    });
    if (error) return toast.error(error.message);
    toast.success("Duncan re-ran the triage");
    load();
  };

  const downloadAttachment = async (att: Attachment) => {
    setDownloadingId(att.id);
    const { data, error } = await supabase.storage
      .from("feature-request-attachments")
      .createSignedUrl(att.storage_path, 60);
    setDownloadingId(null);
    if (error || !data?.signedUrl) return toast.error(error?.message ?? "Failed to get URL");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        <Lightbulb className="h-6 w-6 mx-auto mb-2 opacity-50" />
        No feature requests yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <div key={r.id} className="rounded-lg border border-border bg-background p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-foreground">{r.refined_title ?? r.title}</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {r.user_email ?? "—"} · {format(new Date(r.created_at), "MMM d, yyyy")}
                {r.attachments && r.attachments.length > 0 && (
                  <> · <Paperclip className="inline h-3 w-3 -mt-0.5" /> {r.attachments.length}</>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <TriageBadge status={r.triage_status} />
                {r.priority_band && <Pill tone={priorityTone(r.priority_band)}>{r.priority_band}</Pill>}
                {r.effort_band && <Pill tone="muted">Effort {r.effort_band}</Pill>}
                {r.category && <Pill tone="muted">{r.category}</Pill>}
                {r.rice_score != null && <Pill tone="muted">RICE {r.rice_score.toFixed(1)}</Pill>}
                {r.clarification_round ? <Pill tone="amber">Clarifying · round {r.clarification_round}</Pill> : null}
                {r.workstream_card_id && (
                  <a href="/workstreams" className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> View card
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => rerunTriage(r.id)}
                className="text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded p-1.5 transition-colors"
                title="Re-run Duncan"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => remove(r.id)} className="text-destructive hover:bg-destructive/10 rounded p-1.5 transition-colors" title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {r.problem_statement ? (
            <div className="text-xs text-foreground/90 space-y-1.5">
              <p className="whitespace-pre-wrap"><span className="font-medium">Problem: </span>{r.problem_statement}</p>
              {r.proposed_solution && <p className="whitespace-pre-wrap"><span className="font-medium">Solution: </span>{r.proposed_solution}</p>}
              {r.acceptance_criteria && <p className="whitespace-pre-wrap text-muted-foreground"><span className="font-medium">Acceptance: </span>{r.acceptance_criteria}</p>}
            </div>
          ) : (
            <p className="text-xs text-foreground/90 whitespace-pre-wrap">{r.description}</p>
          )}
          {r.use_case && (
            <p className="text-xs text-muted-foreground italic"><span className="font-medium">Use case:</span> {r.use_case}</p>
          )}

          {r.attachments && r.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {r.attachments.map((att) => (
                <button
                  key={att.id}
                  onClick={() => downloadAttachment(att)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-secondary/60 transition-colors"
                  title={att.file_name}
                >
                  {downloadingId === att.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Download className="h-3 w-3 text-muted-foreground" />}
                  <span className="truncate max-w-[180px]">{att.file_name}</span>
                  {att.size_bytes != null && (
                    <span className="text-muted-foreground">({(att.size_bytes / 1024).toFixed(1)} KB)</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <label className="text-[11px] text-muted-foreground">Status:</label>
            <select
              value={r.status}
              onChange={(e) => updateStatus(r.id, e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {statusOptions.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}

type PillTone = "muted" | "amber" | "red" | "green" | "blue";

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: PillTone }) {
  const toneClass: Record<PillTone, string> = {
    muted: "bg-secondary/60 text-muted-foreground",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    red: "bg-destructive/15 text-destructive",
    green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    blue: "bg-primary/15 text-primary",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

function priorityTone(p: string): PillTone {
  if (p === "P0") return "red";
  if (p === "P1") return "amber";
  if (p === "P2") return "blue";
  return "muted";
}

function TriageBadge({ status }: { status: string | null }) {
  const s = status ?? "new";
  const map: Record<string, { label: string; tone: PillTone }> = {
    new: { label: "Duncan reviewing", tone: "blue" },
    clarifying: { label: "Clarifying", tone: "amber" },
    triaged: { label: "Triaged", tone: "blue" },
    filed: { label: "Filed", tone: "green" },
    dismissed: { label: "Dismissed", tone: "muted" },
  };
  const info = map[s] ?? map.new;
  return <Pill tone={info.tone}>{info.label}</Pill>;
}

