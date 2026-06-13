import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refresh(supa: any, t: any) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  await supa.from("duncan_calendar_tokens").update({
    access_token: j.access_token,
    token_expiry: new Date(Date.now() + j.expires_in * 1000).toISOString(),
  }).eq("id", t.id);
  return j.access_token as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { google_event_id } = await req.json();
    if (!google_event_id) throw new Error("google_event_id required");
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: t } = await supa.from("duncan_calendar_tokens").select("*").limit(1).maybeSingle();
    if (!t) throw new Error("Duncan calendar not connected");
    let token = t.access_token;
    if (new Date(t.token_expiry) <= new Date(Date.now() + 60000)) token = await refresh(supa, t);
    const calId = t.calendar_id;
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${google_event_id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      throw new Error(`google delete failed: ${res.status} ${await res.text()}`);
    }
    await supa.from("key_events").delete().eq("google_event_id", google_event_id);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
