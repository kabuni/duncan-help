import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleMatches(query: string, title: string, fileName: string): boolean {
  const q = normalizeLookup(query);
  const haystack = normalizeLookup(`${title} ${fileName}`);
  if (!q) return false;
  if (haystack.includes(q) || q.includes(normalizeLookup(title)) || q.includes(normalizeLookup(fileName))) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { query, match_count } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uid = userData.user.id;
    const requestedCount = Math.min(Math.max(Number(match_count) || 8, 1), 25);

    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: query, dimensions: 1024 }),
    });
    if (!embRes.ok) {
      return new Response(JSON.stringify({ error: `embedding ${embRes.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const embJson = await embRes.json();
    const queryEmbedding = embJson.data[0].embedding;

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: semanticMatches, error: rpcErr } = await service.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: requestedCount,
      p_user_id: uid,
    });
    if (rpcErr) throw rpcErr;

    const { data: docs, error: docsErr } = await service
      .from("documents")
      .select("id,title,file_name")
      .eq("status", "ready")
      .or(`scope.eq.public,and(scope.eq.private,owner_id.eq.${uid})`)
      .order("created_at", { ascending: false })
      .limit(250);
    if (docsErr) throw docsErr;

    const titleMatchedDocs = (docs || []).filter((d: any) => titleMatches(query, d.title || "", d.file_name || ""));
    const titleMatchedIds = new Set(titleMatchedDocs.map((d: any) => d.id));

    // Title-match path: rather than dumping up to 50 sequential chunks with
    // similarity=1 (which crowds the slice and pushes real semantic matches
    // out), we run the same semantic search restricted to the title-matched
    // doc ids, take the top N per doc, apply a similarity boost, then merge
    // with the general semantic matches into a single ranked list capped at
    // `requestedCount`.
    const PER_DOC_CAP = 5;
    const TITLE_BOOST = 1.15;
    let titleSemanticResults: any[] = [];
    if (titleMatchedDocs.length > 0) {
      const { data: titleSem, error: titleSemErr } = await service.rpc("match_documents", {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: Math.max(requestedCount * 2, PER_DOC_CAP * titleMatchedDocs.length),
        p_user_id: uid,
      });
      if (titleSemErr) throw titleSemErr;

      const titleById = new Map(titleMatchedDocs.map((d: any) => [d.id, d.title]));
      const perDocCount = new Map<string, number>();
      titleSemanticResults = (titleSem || [])
        .filter((r: any) => titleMatchedIds.has(r.document_id))
        .map((r: any) => ({
          ...r,
          similarity: Math.min(1, (r.similarity ?? 0) * TITLE_BOOST),
          document_title: r.document_title || titleById.get(r.document_id) || "Knowledge Base document",
          match_type: "title+semantic",
        }))
        .filter((r: any) => {
          const n = perDocCount.get(r.document_id) || 0;
          if (n >= PER_DOC_CAP) return false;
          perDocCount.set(r.document_id, n + 1);
          return true;
        });

      // Fallback: if semantic returned nothing inside the title-matched docs
      // (very short / noisy queries), surface the first 3 chunks per doc so
      // the user still sees the document they named.
      if (titleSemanticResults.length === 0) {
        const { data: chunks } = await service
          .from("document_chunks")
          .select("id,document_id,content,chunk_index,metadata")
          .in("document_id", titleMatchedDocs.map((d: any) => d.id))
          .order("chunk_index", { ascending: true })
          .limit(3 * titleMatchedDocs.length);
        titleSemanticResults = (chunks || []).map((c: any) => ({
          ...c,
          similarity: 0.7,
          document_title: titleById.get(c.document_id) || c.metadata?.document_title || "Knowledge Base document",
          match_type: "title-fallback",
        }));
      }
    }

    const seen = new Set<string>();
    const results = [...titleSemanticResults, ...(semanticMatches || [])]
      .filter((r: any) => {
        const key = `${r.document_id}:${r.chunk_index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a: any, b: any) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, requestedCount);

    let formatted_context = "";
    if (results.length > 0) {
      const blocks = results.map((r: any) =>
        `Source: ${r.document_title}\n${r.content}`
      ).join("\n\n");
      formatted_context = `The following is from Kabuni's internal knowledge base:\n\n---\n${blocks}\n---`;
    }

    return new Response(JSON.stringify({ results, formatted_context }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("query-knowledge-base error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
