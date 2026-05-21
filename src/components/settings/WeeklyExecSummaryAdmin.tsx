import { useEffect, useState } from "react";
import { FileText, Loader2, Play, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface RunRow {
  id: string;
  run_key: string;
  status: string;
  trigger_source: string;
  folder_name: string | null;
  file_count: number | null;
  recipient: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

export default function WeeklyExecSummaryAdmin() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const loadRuns = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("exec_summary_runs")
      .select("id,run_key,status,trigger_source,folder_name,file_count,recipient,started_at,finished_at,error")
      .order("started_at", { ascending: false })
      .limit(8);
    setLoading(false);
    if (error) {
      toast({ title: "Could not load runs", description: error.message, variant: "destructive" });
      return;
    }
    setRuns((data ?? []) as RunRow[]);
  };

  useEffect(() => { loadRuns(); }, []);

  const runNow = async () => {
    setTriggering(true);
    try {
      const { data, error } = await supabase.functions.invoke("weekly-exec-summary", {
        body: { trigger: "manual", force: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: "Weekly summary generated",
        description: `Sent to ${(data as any)?.recipient || "the recipient"} (${(data as any)?.files_processed ?? 0} source files).`,
      });
      loadRuns();
    } catch (e: any) {
      toast({ title: "Run failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Runs automatically every <strong className="text-foreground">Monday at 08:00 UK</strong>.
            Synthesises the latest Weekly Reports folder into a branded DOCX and emails
            the secure download link to <strong className="text-foreground">simon@kabuni.com</strong>.
          </p>
        </div>
        <button
          onClick={runNow}
          disabled={triggering}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {triggering ? "Generating…" : "Run Now"}
        </button>
      </div>

      <div className="border border-border rounded-lg divide-y divide-border bg-background/50">
        <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Recent runs</span>
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
        {runs.length === 0 && !loading && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No runs yet. The next scheduled run is the upcoming Monday at 08:00 UK.
          </div>
        )}
        {runs.map((r) => {
          const ok = r.status === "succeeded";
          const failed = r.status === "failed";
          return (
            <div key={r.id} className="px-3 py-2.5 flex items-center gap-3 text-xs">
              {ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : failed ? (
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground truncate">
                    {r.folder_name ?? r.run_key}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {r.trigger_source}
                  </span>
                </div>
                <div className="text-muted-foreground truncate">
                  {r.file_count ?? 0} file{r.file_count === 1 ? "" : "s"} ·{" "}
                  {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}
                  {r.error && ` · ${r.error.slice(0, 80)}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
