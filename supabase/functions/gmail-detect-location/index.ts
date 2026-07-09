// Every 6 hours: for each user with location_auto=true, pull their Google
// Calendar primary-timezone setting and store it on profiles. Also opportunistically
// infer country from the timezone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  return r.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getCalendarToken(supa: any, userId: string): Promise<string | null> {
  const { data } = await supa.from("google_calendar_tokens")
    .select("*").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  if (new Date(data.token_expiry).getTime() - Date.now() > 60_000) return data.access_token;
  const r = await refreshGoogleToken(
    data.refresh_token,
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!,
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!,
  );
  if (!r) return null;
  await supa.from("google_calendar_tokens").update({
    access_token: r.access_token,
    token_expiry: new Date(Date.now() + r.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);
  return r.access_token;
}

// Rough IANA-tz → country mapping for the common cases; anything else stays null.
function timezoneToCountry(tz: string): string | null {
  if (!tz) return null;
  const map: Record<string, string> = {
    "Europe/London": "United Kingdom",
    "Europe/Dublin": "Ireland",
    "Europe/Paris": "France", "Europe/Berlin": "Germany", "Europe/Amsterdam": "Netherlands",
    "Europe/Madrid": "Spain", "Europe/Rome": "Italy", "Europe/Zurich": "Switzerland",
    "Asia/Kolkata": "India", "Asia/Calcutta": "India",
    "Asia/Dubai": "United Arab Emirates", "Asia/Singapore": "Singapore",
    "Asia/Hong_Kong": "Hong Kong", "Asia/Tokyo": "Japan",
    "America/New_York": "United States", "America/Chicago": "United States",
    "America/Denver": "United States", "America/Los_Angeles": "United States",
    "America/Toronto": "Canada", "America/Vancouver": "Canada",
    "Australia/Sydney": "Australia", "Australia/Melbourne": "Australia",
  };
  return map[tz] || (tz.startsWith("Europe/") ? tz.split("/")[1] : null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, location_auto, current_timezone")
    .eq("location_auto", true);

  const results: any[] = [];
  for (const p of profiles || []) {
    try {
      const tok = await getCalendarToken(supabaseAdmin, p.id);
      if (!tok) continue;
      const r = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/settings/timezone",
        { headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok) continue;
      const j = await r.json();
      const tz = j.value as string | undefined;
      if (!tz || tz === p.current_timezone) continue;
      const country = timezoneToCountry(tz);
      await supabaseAdmin.from("profiles")
        .update({ current_timezone: tz, current_country: country })
        .eq("id", p.id);
      results.push({ user_id: p.id, tz, country });
    } catch (e: any) {
      results.push({ user_id: p.id, error: e?.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, updated: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
