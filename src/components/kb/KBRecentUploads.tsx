import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trash2, FileText, FileSpreadsheet, File as FileIcon, CheckCircle2, XCircle, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  page_count: number | null;
  chars_extracted: number | null;
  chunks_generated: number | null;
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
  if (s === "failed") {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="gap-1 cursor-help">
              <XCircle className="h-3 w-3" />Failed
            </Badge>
          </TooltipTrigger>
          {err && (
            <TooltipContent className="max-w-xs text-xs leading-snug">
              {err}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <Badge variant="secondary">{s}</Badge>;
}

function QualityCell({ r }: { r: DocRow }) {
  if (r.status === "processing") return <span className="text-muted-foreground text-xs">—</span>;
  const pages = r.page_count;
  const chars = r.chars_extracted;
  const chunks = r.chunks_generated ?? r.chunk_count;
  if (chars == null && chunks == null && pages == null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const density = pages && chars ? Math.round(chars / pages) : null;
  const lowDensity = r.file_type === "pdf" && density != null && pages! > 1 && density < 200;
  const lowChunks = r.status === "ready" && chunks != null && chunks < 2 && (pages == null || pages > 1);
  const warn = lowDensity || lowChunks;

  const tooltip = (
    <div className="space-y-0.5">
      {pages != null && <div>Pages: <span className="font-medium">{pages}</span></div>}
      {chars != null && <div>Characters: <span className="font-medium">{chars.toLocaleString()}</span></div>}
      {chunks != null && <div>Chunks: <span className="font-medium">{chunks}</span></div>}
      {density != null && <div>Density: <span className="font-medium">{density}</span> c/page</div>}
      {lowDensity && <div className="mt-1 text-amber-500">Low text density — likely image-based PDF.</div>}
      {lowChunks && <div className="mt-1 text-amber-500">Very few chunks — content may have failed to extract cleanly.</div>}
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1.5 cursor-help">
            {warn ? (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />Low quality
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {chunks ?? 0} {chunks === 1 ? "chunk" : "chunks"}
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function KBRecentUploads({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data, error } = await supabase
      .from("documents")
      .select("id,title,file_name,file_type,scope,category,status,error_message,chunk_count,page_count,chars_extracted,chunks_generated,created_at,blob_path")
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

  const onRetry = async (id: string) => {
    setRetrying((s) => new Set(s).add(id));
    try {
      await supabase.from("documents").update({
        status: "processing",
        error_message: null,
      }).eq("id", id);
      const { error } = await supabase.functions.invoke("process-document", { body: { document_id: id } });
      if (error) throw error;
      toast.success("Reprocessing started");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Retry failed");
    } finally {
      setRetrying((s) => { const n = new Set(s); n.delete(id); return n; });
    }
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
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Quality</th>
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
                      <span className="truncate max-w-[280px]" title={r.title}>{r.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="text-xs">{r.scope === "public" ? "Company" : "Private"}</Badge>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge s={r.status} err={r.error_message} /></td>
                  <td className="px-4 py-2.5"><QualityCell r={r} /></td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {(r.status === "failed" || r.status === "ready") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRetry(r.id)}
                          disabled={retrying.has(r.id)}
                          title={r.status === "failed" ? "Retry" : "Reprocess"}
                        >
                          {retrying.has(r.id)
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <RefreshCw className="h-4 w-4" />}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => onDelete(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
