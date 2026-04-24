import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Change {
  type: string;
  description: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify admin
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { releaseId } = await req.json();
    if (!releaseId) {
      return new Response(JSON.stringify({ error: "releaseId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: release, error: fetchErr } = await supabase
      .from("releases")
      .select("*")
      .eq("id", releaseId)
      .single();
    if (fetchErr || !release) throw new Error("Release not found");

    const changes = (release.changes as Change[]) || [];
    let title = release.title;
    let summary = release.summary;

    const needsTitle = !title || title.trim() === "" || title === "Draft";
    const needsSummary = !summary || summary.trim() === "";

    if ((needsTitle || needsSummary) && changes.length > 0) {
      const changesText = changes
        .map((c) => `- [${c.type}] ${c.description}`)
        .join("\n");

      try {
        const aiData = await callLLMWithFallback({
          workflow: "finalize-release",
          messages: [
            {
              role: "system",
              content:
                "You write concise release notes for an internal company tool called Duncan. Output strict JSON with keys 'title' (max 8 words, no version number) and 'summary' (1-2 sentences, plain English, what users will notice).",
            },
            {
              role: "user",
              content: `Release version ${release.version} contains these changes:\n${changesText}\n\nReturn JSON: {"title": "...", "summary": "..."}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
        });
        try {
          const parsed = JSON.parse(aiData.choices[0].message.content);
          if (needsTitle && parsed.title) title = parsed.title;
          if (needsSummary && parsed.summary) summary = parsed.summary;
        } catch (e: any) {
          console.error("Failed to parse AI JSON", e);
        }
      } catch (err: any) {
        console.error("LLM failed", err?.status, err?.message);
      }
    }

    if (!title || title.trim() === "") title = `Release ${release.version}`;
    if (!summary || summary.trim() === "") summary = `${changes.length} change${changes.length === 1 ? "" : "s"} in this release.`;

    const { error: updateErr } = await supabase
      .from("releases")
      .update({
        title,
        summary,
        status: "published",
        published_at: new Date().toISOString(),
        published_by: user.id,
      })
      .eq("id", releaseId);
    if (updateErr) throw updateErr;

    // Trigger release email notifications (best-effort)
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-release-emails`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ releaseId }),
      });
    } catch (e: any) {
      console.error("send-release-emails failed (non-fatal)", e);
    }

    return new Response(
      JSON.stringify({ success: true, title, summary, version: release.version }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("finalize-release error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
