import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface Body {
  event_name: string;
  category?: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location?: string | null;
  notes?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      throw new Error("Google Calendar credentials not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.event_name || !body?.start_at || !body?.end_at) {
      return new Response(
        JSON.stringify({ error: "event_name, start_at and end_at are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const startDate = new Date(body.start_at);
    const endDate = new Date(body.end_at);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return new Response(
        JSON.stringify({ error: "start_at and end_at must be valid ISO datetimes" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (endDate <= startDate) {
      return new Response(
        JSON.stringify({ error: "end_at must be after start_at", code: "INVERTED_RANGE" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from("google_calendar_tokens")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (tokenError || !tokenData) {
      return new Response(
        JSON.stringify({
          error: "Personal Google Calendar not connected",
          code: "NOT_CONNECTED",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let accessToken = tokenData.access_token as string;
    const tokenExpiry = new Date(tokenData.token_expiry as string);

    if (tokenExpiry <= new Date()) {
      const refreshResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokenData.refresh_token as string,
          grant_type: "refresh_token",
        }),
      });
      if (!refreshResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to refresh token", code: "REFRESH_FAILED" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const newTokens = await refreshResponse.json();
      accessToken = newTokens.access_token;
      const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000);
      await supabaseAdmin
        .from("google_calendar_tokens")
        .update({
          access_token: accessToken,
          token_expiry: newExpiry.toISOString(),
        })
        .eq("user_id", user.id);
    }

    const summary = body.category
      ? `[${body.category}] ${body.event_name}`
      : body.event_name;

    const startObj = body.all_day
      ? { date: body.start_at.slice(0, 10) }
      : { dateTime: new Date(body.start_at).toISOString(), timeZone: "UTC" };

    // For all-day Google events, end.date is exclusive — bump by 1 day
    let endObj: Record<string, string>;
    if (body.all_day) {
      const endDate = new Date(body.end_at);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      endObj = { date: endDate.toISOString().slice(0, 10) };
    } else {
      endObj = { dateTime: new Date(body.end_at).toISOString(), timeZone: "UTC" };
    }

    const eventBody: Record<string, unknown> = {
      summary,
      start: startObj,
      end: endObj,
    };
    if (body.location) eventBody.location = body.location;
    if (body.notes) eventBody.description = body.notes;

    const resp = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Google insert failed", resp.status, errText);
      return new Response(
        JSON.stringify({ error: "Google Calendar insert failed", details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const created = await resp.json();
    return new Response(
      JSON.stringify({ id: created.id, htmlLink: created.htmlLink }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("add-event-to-personal-calendar error", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
