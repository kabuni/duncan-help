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

    const { query, user_id, match_count } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uid = user_id || userData.user.id;
    const k = Math.min(Math.max(Number(match_count) || 8, 1), 25);

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
      match_threshold: 0.7,
      match_count: k,
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
    let titleMatchesResults: any[] = [];
    if (titleMatchedDocs.length > 0) {
      const { data: chunks, error: chunksErr } = await service
        .from("document_chunks")
        .select("id,document_id,content,chunk_index,metadata")
        .in("document_id", titleMatchedDocs.map((d: any) => d.id))
        .order("chunk_index", { ascending: true })
        .limit(k);
      if (chunksErr) throw chunksErr;
      const titleById = new Map(titleMatchedDocs.map((d: any) => [d.id, d.title]));
      titleMatchesResults = (chunks || []).map((c: any) => ({
        ...c,
        similarity: 1,
        document_title: titleById.get(c.document_id) || c.metadata?.document_title || "Knowledge Base document",
        match_type: "title",
      }));
    }

    const seen = new Set<string>();
    const results = [...titleMatchesResults, ...(semanticMatches || [])]
      .filter((r: any) => {
        const key = `${r.document_id}:${r.chunk_index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, k);
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
