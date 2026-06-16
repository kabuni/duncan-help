// Pulls latest Instagram metrics for the connected business account and stores a snapshot.
// Callable by service role (cron) or by any signed-in user (manual refresh).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    const { data: tok } = await admin
      .from("instagram_tokens")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!tok) return json({ error: "No Instagram connection" }, 404);

    const igId = tok.ig_business_id as string;
    const token = tok.page_access_token as string;

    // Account fields
    const accRes = await fetch(
      `${GRAPH}/${igId}?fields=username,followers_count,follows_count,media_count&access_token=${encodeURIComponent(token)}`,
    );
    const acc = await accRes.json();
    if (!accRes.ok) return json({ error: "Account fetch failed", detail: acc }, 502);

    // Insights helper — uses metric_type=total_value (v21+) for windowed metrics
    const fetchTotal = async (metric: string, days: number) => {
      const since = Math.floor((Date.now() - days * 86400000) / 1000);
      const until = Math.floor(Date.now() / 1000);
      const u = new URL(`${GRAPH}/${igId}/insights`);
      u.searchParams.set("metric", metric);
      u.searchParams.set("period", "day");
      u.searchParams.set("metric_type", "total_value");
      u.searchParams.set("since", String(since));
      u.searchParams.set("until", String(until));
      u.searchParams.set("access_token", token);
      const r = await fetch(u);
      const j = await r.json();
      if (!r.ok) return { error: j, value: null as number | null };
      const v = j?.data?.[0]?.total_value?.value;
      return { value: typeof v === "number" ? v : null, raw: j };
    };

    const [reach28, imp28, pv28, reach7, imp7] = await Promise.all([
      fetchTotal("reach", 28),
      fetchTotal("impressions", 28),
      fetchTotal("profile_views", 28),
      fetchTotal("reach", 7),
      fetchTotal("impressions", 7),
    ]);

    // Followers gained over last 28 days vs previous snapshot
    const { data: prev } = await admin
      .from("instagram_insights_snapshots")
      .select("followers_count, captured_at")
      .eq("ig_business_id", igId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const followers = acc.followers_count ?? null;
    const followersGained =
      followers != null && prev?.followers_count != null ? followers - prev.followers_count : null;

    const payload = {
      ig_business_id: igId,
      followers_count: followers,
      follows_count: acc.follows_count ?? null,
      media_count: acc.media_count ?? null,
      followers_gained_28d: followersGained,
      reach_28d: reach28.value,
      impressions_28d: imp28.value,
      profile_views_28d: pv28.value,
      reach_7d: reach7.value,
      impressions_7d: imp7.value,
      raw: { account: acc, reach28: reach28.raw, imp28: imp28.raw, pv28: pv28.raw, reach7: reach7.raw, imp7: imp7.raw },
    };

    const { error: insErr } = await admin.from("instagram_insights_snapshots").insert(payload);
    if (insErr) return json({ error: "Insert failed", detail: insErr.message }, 500);

    return json({ ok: true, snapshot: payload });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
