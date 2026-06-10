import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Search, AlertTriangle, FileStack, Gauge, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type TopQuery = { query_normalized: string; sample_query: string; search_count: number; avg_top_similarity: number; avg_result_count: number; last_searched_at: string };
type TopDoc = { document_id: string; title: string; file_type: string; scope: string; retrieval_count: number; last_retrieved_at: string };
type UnretrievedDoc = { id: string; title: string; file_type: string; scope: string; chunk_count: number; created_at: string };
type AvgSim = { query_normalized: string; sample_query: string; search_count: number; avg_top_similarity: number; min_top_similarity: number; max_top_similarity: number };
type WeakQuery = { id: string; user_id: string | null; query: string; top_similarity: number | null; result_count: number; created_at: string };

function simBadge(v: number | null | undefined) {
  if (v == null) return <Badge variant="destructive">none</Badge>;
  const n = Number(v);
  if (n >= 0.7) return <Badge className="bg-emerald-600 hover:bg-emerald-600">{n.toFixed(3)}</Badge>;
  if (n >= 0.55) return <Badge className="bg-amber-500 hover:bg-amber-500 text-black">{n.toFixed(3)}</Badge>;
  return <Badge variant="destructive">{n.toFixed(3)}</Badge>;
}

function StatCard({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-xs text-muted-foreground">{children}</div>;
}

export default function KBObservability() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [topQueries, setTopQueries] = useState<TopQuery[]>([]);
  const [topDocs, setTopDocs] = useState<TopDoc[]>([]);
  const [unretrieved, setUnretrieved] = useState<UnretrievedDoc[]>([]);
  const [avgSim, setAvgSim] = useState<AvgSim[]>([]);
  const [weak, setWeak] = useState<WeakQuery[]>([]);
  const [docsIndexed, setDocsIndexed] = useState<number>(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [a, b, c, d, e, f] = await Promise.all([
        supabase.from("kb_query_log_top_queries" as any).select("*").limit(50),
        supabase.from("kb_query_log_top_documents" as any).select("*").limit(50),
        supabase.from("kb_query_log_unretrieved_documents" as any).select("*").limit(100),
        supabase.from("kb_query_log_avg_similarity_by_query" as any).select("*").limit(50),
        supabase.from("kb_query_log_weak_queries" as any).select("*").limit(100),
        supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "ready"),
      ]);
      if (a.error?.code === "42501" || b.error?.code === "42501") setAllowed(false);
      setTopQueries((a.data as any) || []);
      setTopDocs((b.data as any) || []);
      setUnretrieved((c.data as any) || []);
      setAvgSim((d.data as any) || []);
      setWeak((e.data as any) || []);
      setDocsIndexed(f.count || 0);
      setLoading(false);
    })();
  }, []);

  if (!allowed) {
    return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading analytics…
      </div>
    );
  }

  const totalSearches = topQueries.reduce((s, r) => s + Number(r.search_count || 0), 0);
  const allSims = avgSim.map((r) => Number(r.avg_top_similarity)).filter((n) => !isNaN(n));
  const overallAvg = allSims.length ? allSims.reduce((a, b) => a + b, 0) / allSims.length : null;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Retrieval analytics</h2>
          <p className="text-xs text-muted-foreground mt-0.5">How Duncan is using the knowledge base · last 30 days</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Search} label="Total searches" value={totalSearches.toLocaleString()} hint={`${topQueries.length} unique queries`} />
        <StatCard icon={AlertTriangle} label="Weak queries" value={weak.length} hint="Top sim < 0.55 or zero results" />
        <StatCard icon={FileStack} label="Documents indexed" value={docsIndexed} hint={`${unretrieved.length} never retrieved`} />
        <StatCard icon={Gauge} label="Avg top similarity" value={overallAvg != null ? overallAvg.toFixed(3) : "—"} hint="Across all queries" />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Top queries" subtitle="Most-searched questions">
          {topQueries.length === 0 ? (
            <EmptyState><Inbox className="h-5 w-5 mx-auto mb-2 opacity-50" />No searches recorded yet.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Query</th><th className="text-left px-2 py-2 font-medium">Hits</th><th className="text-left px-2 py-2 font-medium">Avg sim</th></tr>
              </thead>
              <tbody>
                {topQueries.slice(0, 10).map((r) => (
                  <tr key={r.query_normalized} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[260px]" title={r.sample_query}>{r.sample_query}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.search_count}</td>
                    <td className="px-2 py-2">{simBadge(r.avg_top_similarity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Top documents" subtitle="Most frequently retrieved">
          {topDocs.length === 0 ? (
            <EmptyState><Inbox className="h-5 w-5 mx-auto mb-2 opacity-50" />No retrievals recorded yet.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Document</th><th className="text-left px-2 py-2 font-medium">Scope</th><th className="text-left px-2 py-2 font-medium">Hits</th></tr>
              </thead>
              <tbody>
                {topDocs.slice(0, 10).map((r) => (
                  <tr key={r.document_id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[260px]" title={r.title}>{r.title}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.scope === "public" ? "Company" : "Private"}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.retrieval_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Weak queries" subtitle="Zero results or top similarity below 0.55">
          {weak.length === 0 ? (
            <EmptyState>No weak queries detected — nice.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Query</th><th className="text-left px-2 py-2 font-medium">Top sim</th><th className="text-left px-2 py-2 font-medium">Results</th></tr>
              </thead>
              <tbody>
                {weak.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[260px]" title={r.query}>{r.query}</td>
                    <td className="px-2 py-2">{simBadge(r.top_similarity)}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.result_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Unretrieved documents" subtitle="Ready but never returned — candidates for re-tagging or archive">
          {unretrieved.length === 0 ? (
            <EmptyState>Every ready document has been retrieved at least once.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Document</th><th className="text-left px-2 py-2 font-medium">Type</th><th className="text-left px-2 py-2 font-medium">Chunks</th></tr>
              </thead>
              <tbody>
                {unretrieved.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[260px]" title={r.title}>{r.title}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs uppercase">{r.file_type}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.chunk_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {/* Average similarity full-width */}
      <Panel title="Average similarity by query" subtitle="Spread of retrieval confidence per question">
        {avgSim.length === 0 ? (
          <EmptyState>No data yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Query</th><th className="text-left px-2 py-2 font-medium">Searches</th><th className="text-left px-2 py-2 font-medium">Avg</th><th className="text-left px-2 py-2 font-medium">Min</th><th className="text-left px-2 py-2 font-medium">Max</th></tr>
              </thead>
              <tbody>
                {avgSim.slice(0, 20).map((r) => (
                  <tr key={r.query_normalized} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[420px]" title={r.sample_query}>{r.sample_query}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.search_count}</td>
                    <td className="px-2 py-2">{simBadge(r.avg_top_similarity)}</td>
                    <td className="px-2 py-2">{simBadge(r.min_top_similarity)}</td>
                    <td className="px-2 py-2">{simBadge(r.max_top_similarity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
