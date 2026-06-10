import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, BarChart3 } from "lucide-react";
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

export default function KBObservability() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [topQueries, setTopQueries] = useState<TopQuery[]>([]);
  const [topDocs, setTopDocs] = useState<TopDoc[]>([]);
  const [unretrieved, setUnretrieved] = useState<UnretrievedDoc[]>([]);
  const [avgSim, setAvgSim] = useState<AvgSim[]>([]);
  const [weak, setWeak] = useState<WeakQuery[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [a, b, c, d, e] = await Promise.all([
        supabase.from("kb_query_log_top_queries" as any).select("*").limit(50),
        supabase.from("kb_query_log_top_documents" as any).select("*").limit(50),
        supabase.from("kb_query_log_unretrieved_documents" as any).select("*").limit(100),
        supabase.from("kb_query_log_avg_similarity_by_query" as any).select("*").limit(50),
        supabase.from("kb_query_log_weak_queries" as any).select("*").limit(100),
      ]);
      // If RLS blocks (non-admin), every result is an empty array with no error
      // but the user clearly shouldn't be on this page. Hide gracefully.
      if (a.error?.code === "42501" || b.error?.code === "42501") setAllowed(false);
      setTopQueries((a.data as any) || []);
      setTopDocs((b.data as any) || []);
      setUnretrieved((c.data as any) || []);
      setAvgSim((d.data as any) || []);
      setWeak((e.data as any) || []);
      setLoading(false);
    })();
  }, []);

  if (!allowed) {
    return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Retrieval observability</h2>
        <span className="text-xs text-muted-foreground ml-2">Last 30 days</span>
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
      ) : (
        <Tabs defaultValue="queries" className="p-4">
          <TabsList>
            <TabsTrigger value="queries">Top queries</TabsTrigger>
            <TabsTrigger value="docs">Top documents</TabsTrigger>
            <TabsTrigger value="unretrieved">Never retrieved</TabsTrigger>
            <TabsTrigger value="similarity">Avg similarity</TabsTrigger>
            <TabsTrigger value="weak">Weak results</TabsTrigger>
          </TabsList>

          <TabsContent value="queries" className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Query</th><th className="text-left px-2 py-2 font-medium">Searches</th><th className="text-left px-2 py-2 font-medium">Avg top sim</th><th className="text-left px-2 py-2 font-medium">Avg results</th><th className="text-left px-2 py-2 font-medium">Last</th></tr>
              </thead>
              <tbody>
                {topQueries.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground text-xs">No data yet.</td></tr>}
                {topQueries.map((r) => (
                  <tr key={r.query_normalized} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[420px]" title={r.sample_query}>{r.sample_query}</td>
                    <td className="px-2 py-2">{r.search_count}</td>
                    <td className="px-2 py-2">{simBadge(r.avg_top_similarity)}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.avg_result_count}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{new Date(r.last_searched_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="docs" className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Document</th><th className="text-left px-2 py-2 font-medium">Type</th><th className="text-left px-2 py-2 font-medium">Scope</th><th className="text-left px-2 py-2 font-medium">Retrievals</th><th className="text-left px-2 py-2 font-medium">Last</th></tr>
              </thead>
              <tbody>
                {topDocs.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground text-xs">No data yet.</td></tr>}
                {topDocs.map((r) => (
                  <tr key={r.document_id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[420px]" title={r.title}>{r.title}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs uppercase">{r.file_type}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.scope === "public" ? "Company" : "Private"}</td>
                    <td className="px-2 py-2">{r.retrieval_count}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{new Date(r.last_retrieved_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="unretrieved" className="mt-4 overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-3">Ready documents never returned by any search in the last 30 days. Candidates for archive, re-tagging, or re-titling.</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Document</th><th className="text-left px-2 py-2 font-medium">Type</th><th className="text-left px-2 py-2 font-medium">Chunks</th><th className="text-left px-2 py-2 font-medium">Added</th></tr>
              </thead>
              <tbody>
                {unretrieved.length === 0 && <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground text-xs">Every ready document has been retrieved at least once.</td></tr>}
                {unretrieved.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[420px]" title={r.title}>{r.title}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs uppercase">{r.file_type}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.chunk_count}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="similarity" className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Query</th><th className="text-left px-2 py-2 font-medium">Searches</th><th className="text-left px-2 py-2 font-medium">Avg</th><th className="text-left px-2 py-2 font-medium">Min</th><th className="text-left px-2 py-2 font-medium">Max</th></tr>
              </thead>
              <tbody>
                {avgSim.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground text-xs">No data yet.</td></tr>}
                {avgSim.map((r) => (
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
          </TabsContent>

          <TabsContent value="weak" className="mt-4 overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-3">Searches that returned zero results or a top similarity below 0.55. These are the queries Duncan is failing to answer well.</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left px-2 py-2 font-medium">Query</th><th className="text-left px-2 py-2 font-medium">Top sim</th><th className="text-left px-2 py-2 font-medium">Results</th><th className="text-left px-2 py-2 font-medium">When</th></tr>
              </thead>
              <tbody>
                {weak.length === 0 && <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground text-xs">No weak queries — nice.</td></tr>}
                {weak.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-2 py-2 truncate max-w-[420px]" title={r.query}>{r.query}</td>
                    <td className="px-2 py-2">{simBadge(r.top_similarity)}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{r.result_count}</td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
