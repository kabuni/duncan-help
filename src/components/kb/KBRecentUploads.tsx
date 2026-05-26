import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trash2, FileText, FileSpreadsheet, File as FileIcon, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface DocRow {
  id: string;
  title: string;
  file_name: string;
  file_type: string;
  scope: string;
  category: string | null;
  status: string;
  error_message: string | null;
  chunk_count: number;
  created_at: string;
  blob_path: string;
}

function typeIcon(t: string) {
  if (t === "pdf") return <FileText className="h-4 w-4 text-red-500" />;
  if (t === "docx") return <FileText className="h-4 w-4 text-blue-500" />;
  if (t === "xlsx" || t === "csv") return <FileSpreadsheet className="h-4 w-4 text-emerald-500" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground" />;
}

function StatusBadge({ s, err }: { s: string; err?: string | null }) {
  if (s === "processing") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Processing</Badge>;
  if (s === "ready") return <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3" />Ready</Badge>;
  if (s === "failed") return <Badge variant="destructive" className="gap-1" title={err ?? ""}><XCircle className="h-3 w-3" />Failed</Badge>;
  return <Badge variant="secondary">{s}</Badge>;
}

export default function KBRecentUploads({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data, error } = await supabase
      .from("documents")
      .select("id,title,file_name,file_type,scope,category,status,error_message,chunk_count,created_at,blob_path")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error && data) setRows(data as DocRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [refreshKey]);

  useEffect(() => {
    const anyProcessing = rows.some((r) => r.status === "processing");
    if (!anyProcessing) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [rows]);

  const onDelete = async (id: string) => {
    if (!confirm("Delete this document and all its chunks?")) return;
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); load(); }
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Recent uploads</h2>
        <span className="text-xs text-muted-foreground">{rows.length} most recent</span>
      </div>
      {loading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No uploads yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Scope</th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {typeIcon(r.file_type)}
                      <span className="truncate max-w-[280px]">{r.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="text-xs">{r.scope === "public" ? "Company" : "Private"}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{r.category ?? "—"}</td>
                  <td className="px-4 py-2.5"><StatusBadge s={r.status} err={r.error_message} /></td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => onDelete(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
