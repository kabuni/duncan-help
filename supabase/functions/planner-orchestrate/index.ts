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
intent: CREATE_EVENT | UPDATE_EVENT | CANCEL_EVENT | FIND_EVENT | CHECK_AVAILABILITY — use CANCEL_EVENT for remove/delete/cancel/"take it out" wording, FIND_EVENT for pure look-ups
event_type: MEETING | AVAILABILITY | OUT_OF_OFFICE | ANNUAL_LEAVE | SICK_LEAVE | COMPANY_EVENT | PROJECT_MILESTONE | PERSONAL_APPOINTMENT | TRAVEL | OTHER
Choosing event_type correctly matters more than anything else:
- COMPANY_EVENT = anything the whole company would want to see: launches, releases, go-lives, rollouts, all-hands, town halls, conferences, showcases, campaigns, webinars, company socials, awaydays, board/investor days, announcements. These are Planner records only and must NOT be put on a personal calendar.
- PROJECT_MILESTONE = a company deadline, milestone, cut-off or target date with no gathering.
- MEETING = people actually getting together (meeting, call, sync, 1:1, interview, workshop with someone). A "launch planning meeting" is a MEETING, a "product launch" is a COMPANY_EVENT.
- PERSONAL_APPOINTMENT = dentist, doctor, optician, physio, school run and similar private commitments — personal calendar only.
title: short human title
start: ISO 8601 datetime (or date at 00:00 for all-day)
end: ISO 8601 datetime (for all-day, the same day end; for meetings, start + duration; default meeting duration 30 minutes)
all_day: boolean
current_start: ISO date of where the event sits TODAY, only for UPDATE_EVENT
planner_category: one of Travel | Holiday | PublicHoliday | GlobalAllHands | TeamSocials | Product | Releases | Event | Super Coaches | Investor | Social | PR | Launch | Marketing | Operations | Communication | Creative | BusinessDevelopment — the best matching EXISTING Planner category. Never invent a new one; use Event if genuinely unclear.
audience: PERSONAL | TEAM | COMPANY — who this is for. Omit if unclear.
attendance_required: true only when people actually have to turn up at a time (meeting, party, all-hands, ceremony). Omit entirely if the person did not make it clear — do NOT guess.
attendee_names: array of first names mentioned
missing: array of names of details the person did not give (e.g. "start", "attendee_email")
Use ANNUAL_LEAVE (not OUT_OF_OFFICE) whenever a person says they are off, taking leave, on holiday or not working — OUT_OF_OFFICE is only for an explicit "out of office"/"away from my desk" block that is not leave.
Resolve relative dates ("next Friday", "tomorrow", "30 September") against today. Never invent an exact time for a request with no time — set all_day true instead. Do NOT decide which calendar/system to use — audience and attendance are signals only.`;
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
      const decision = decideDestination((body.intent ?? "CREATE_EVENT") as PlannerIntent, eventType, {
        overrides,
        text: `${body.utterance ?? ""} ${body.title ?? ""}`,
        suggested_category: body.planner_category,
      });
      return new Response(JSON.stringify({ decision }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const timezone = body.timezone || "Europe/London";

    // Natural-language mode: interpret first, then run the same decision engine.
    let request: ActionRequest = body as ActionRequest;
    let interpretation: any = null;
    if (body.interpret && body.utterance) {
      interpretation = await interpretUtterance(body.utterance, timezone, new Date().toISOString());
      const names: string[] = Array.isArray(interpretation.attendee_names) ? interpretation.attendee_names : [];
      let attendees: string[] = [];
      if (names.length) {
        const { data: people } = await supabaseAdmin
          .from("profiles")
          .select("email, display_name")
          .limit(500);
        attendees = names
          .map((n) => (people || []).find((p: any) =>
            String(p.display_name || "").toLowerCase().includes(String(n).toLowerCase()))?.email)
          .filter(Boolean) as string[];
      }
      request = {
        intent: interpretation.intent || "CREATE_EVENT",
        event_type: interpretation.event_type,
        utterance: body.utterance,
        title: interpretation.title,
        start: interpretation.start,
        end: interpretation.end,
        all_day: interpretation.all_day,
        current_start: interpretation.current_start,
        attendees,
        planner_category: interpretation.planner_category,
        force: body.force === true,
      };
    }

    const result = await executePlannerAction(
      {
        supabaseAdmin,
        userId: user.id,
        userEmail: user.email,
        timezone,
        getGoogleToken: () => getCalendarAccessToken(user.id, supabaseAdmin),
      },
      request,
    );

    return new Response(JSON.stringify({ ...result, interpretation, request }), {
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
