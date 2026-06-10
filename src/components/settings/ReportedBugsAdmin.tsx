import { useEffect, useState } from "react";
import { Loader2, Trash2, Bug, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface Issue {
  id: string;
  user_email: string | null;
  title: string;
  issue_type: string | null;
  description: string;
  expected_behavior: string | null;
  actual_behavior: string | null;
  affected_area: string | null;
  attachment_paths: string[] | null;
  created_at: string;
}

export default function ReportedBugsAdmin() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("issues")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setIssues((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm("Delete this bug report?")) return;
    const { error } = await supabase.from("issues").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setIssues((prev) => prev.filter((r) => r.id !== id));
    toast.success("Deleted");
  };

  const downloadAttachment = async (path: string) => {
    setDownloadingPath(path);
    const { data, error } = await supabase.storage
      .from("issue-attachments")
      .createSignedUrl(path, 60);
    setDownloadingPath(null);
    if (error || !data?.signedUrl) return toast.error(error?.message ?? "Failed to get URL");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (issues.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        <Bug className="h-6 w-6 mx-auto mb-2 opacity-50" />
        No bug reports yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {issues.map((r) => (
        <div key={r.id} className="rounded-lg border border-border bg-background p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-foreground">{r.title}</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {r.user_email ?? "—"} · {format(new Date(r.created_at), "MMM d, yyyy")}
                {r.issue_type && <> · {r.issue_type}</>}
                {r.affected_area && <> · {r.affected_area}</>}
              </p>
            </div>
            <button onClick={() => remove(r.id)} className="text-destructive hover:bg-destructive/10 rounded p-1.5 transition-colors" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-foreground/90 whitespace-pre-wrap">{r.description}</p>
          {r.expected_behavior && (
            <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Expected:</span> {r.expected_behavior}</p>
          )}
          {r.actual_behavior && (
            <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Actual:</span> {r.actual_behavior}</p>
          )}

          {r.attachment_paths && r.attachment_paths.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {r.attachment_paths.map((path) => {
                const name = path.split("/").pop() ?? path;
                return (
                  <button
                    key={path}
                    onClick={() => downloadAttachment(path)}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-secondary/60 transition-colors"
                    title={name}
                  >
                    {downloadingPath === path
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Download className="h-3 w-3 text-muted-foreground" />}
                    <span className="truncate max-w-[180px]">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
