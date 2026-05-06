import { useEffect, useState } from "react";
import { Loader2, Trash2, Lightbulb, Paperclip, Download } from "lucide-react";
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
              <h4 className="text-sm font-semibold text-foreground">{r.title}</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {r.user_email ?? "—"} · {format(new Date(r.created_at), "MMM d, yyyy")} · Priority: {r.priority}
                {r.attachments && r.attachments.length > 0 && (
                  <> · <Paperclip className="inline h-3 w-3 -mt-0.5" /> {r.attachments.length}</>
                )}
              </p>
            </div>
            <button onClick={() => remove(r.id)} className="text-destructive hover:bg-destructive/10 rounded p-1.5 transition-colors" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-foreground/90 whitespace-pre-wrap">{r.description}</p>
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
