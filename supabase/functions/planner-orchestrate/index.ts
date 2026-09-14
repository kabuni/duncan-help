import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  executePlannerAction,
  decideDestination,
  classifyEventType,
  loadDestinationConfig,
  type ActionRequest,
  type EventType,
  type PlannerIntent,
} from "../_shared/planner-orchestrator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

async function getCalendarAccessToken(userId: string, supabaseAdmin: any): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const { data: tokenData } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!tokenData) return null;

  if (new Date(tokenData.token_expiry) <= new Date()) {
    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) return null;
    const t = await resp.json();
    await supabaseAdmin
      .from("google_calendar_tokens")
      .update({ access_token: t.access_token, token_expiry: new Date(Date.now() + t.expires_in * 1000).toISOString() })
      .eq("user_id", userId);
    return t.access_token;
  }
  return tokenData.access_token;
}

/**
 * Turns a raw natural-language utterance into a structured ActionRequest.
 * The model interprets intent ONLY — it never decides the destination; that is
 * the orchestration layer's job.
 */
async function interpretUtterance(utterance: string, timezone: string, nowISO: string) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  const system = `You convert a person's planning request into structured JSON. Today is ${nowISO} (timezone ${timezone}).
Return ONLY JSON with keys:
intent: CREATE_EVENT | UPDATE_EVENT | CANCEL_EVENT | CHECK_AVAILABILITY
event_type: MEETING | AVAILABILITY | OUT_OF_OFFICE | ANNUAL_LEAVE | SICK_LEAVE | COMPANY_EVENT | PROJECT_MILESTONE | TRAVEL | OTHER
title: short human title
start: ISO 8601 datetime (or date at 00:00 for all-day)
end: ISO 8601 datetime (for all-day, the same day end; for meetings, start + duration; default meeting duration 30 minutes)
all_day: boolean
current_start: ISO date of where the event sits TODAY, only for UPDATE_EVENT
attendee_names: array of first names mentioned
missing: array of names of details the person did not give (e.g. "start", "attendee_email")
Resolve relative dates ("next Friday", "tomorrow", "30 September") against today. Never invent an exact time for a request with no time — set all_day true instead. Do NOT decide which calendar/system to use.`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: utterance }],
    }),
  });
  if (!resp.ok) throw new Error(`Interpretation failed [${resp.status}]: ${await resp.text()}`);
  const json = await resp.json();
  return JSON.parse(json.choices?.[0]?.message?.content || "{}");
}

serve(async (req) => {

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (!user || userError) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();

    // Dry-run: return only the routing decision (used by UIs that want to show
    // "this will go to Planner + Google Calendar" without writing anything).
    if (body.dry_run) {
      const overrides = await loadDestinationConfig(supabaseAdmin);
      const eventType: EventType = body.event_type ?? classifyEventType(`${body.utterance ?? ""} ${body.title ?? ""}`);
      const decision = decideDestination((body.intent ?? "CREATE_EVENT") as PlannerIntent, eventType, { overrides });
      return new Response(JSON.stringify({ decision }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await executePlannerAction(
      {
        supabaseAdmin,
        userId: user.id,
        userEmail: user.email,
        timezone: body.timezone || "Europe/London",
        getGoogleToken: () => getCalendarAccessToken(user.id, supabaseAdmin),
      },
      body as ActionRequest,
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("planner-orchestrate failed:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
