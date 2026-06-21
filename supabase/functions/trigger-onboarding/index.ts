// Onboarding automation: when a candidate is marked Hired, build the full
// onboarding workstream (card + tasks + welcome email + calendar events +
// AI-drafted 30/60/90 plan) and link everything back to the candidate.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface Body {
  candidate_id: string;
  start_date?: string;        // YYYY-MM-DD
  hiring_manager_id?: string; // profile/auth user id
  employment_type?: string;   // full_time | part_time | contractor
  work_location?: string;     // remote | office | hybrid
  preferred_name?: string;
}

type Task = { title: string; description?: string; group: string; offsetDays?: number; assignee?: string | null };

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

async function refreshGoogleToken(admin: any, row: any): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  if (new Date(row.token_expiry) > new Date(Date.now() + 60_000)) return row.access_token;
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const expiry = new Date(Date.now() + j.expires_in * 1000).toISOString();
  await admin.from("google_calendar_tokens").update({ access_token: j.access_token, token_expiry: expiry }).eq("user_id", row.user_id);
  return j.access_token;
}

async function callOpenAI(messages: any[], tools?: any[]): Promise<any> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const body: any = { model: "gpt-4o", messages, temperature: 0.4 };
  if (tools) { body.tools = tools; body.tool_choice = "required"; }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.error("openai err", await r.text()); return null; }
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.candidate_id) {
      return new Response(JSON.stringify({ error: "candidate_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load candidate + role
    const { data: candidate, error: cErr } = await admin
      .from("candidates")
      .select("*, job_roles!inner(id, title, description, jd_storage_path)")
      .eq("id", body.candidate_id)
      .maybeSingle();
    if (cErr || !candidate) {
      return new Response(JSON.stringify({ error: "Candidate not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Idempotency
    if (candidate.onboarding_card_id) {
      return new Response(JSON.stringify({ success: true, card_id: candidate.onboarding_card_id, already_exists: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const role = candidate.job_roles;
    // Infer department from role title (no department column on job_roles)
    const titleLc = (role?.title || "").toLowerCase();
    const department =
      /engineer|developer|software|backend|frontend|devops|sre|qa/.test(titleLc) ? "Engineering" :
      /sales|account exec|bdr|sdr/.test(titleLc) ? "Sales" :
      /market|growth|content|seo|brand/.test(titleLc) ? "Marketing" :
      /product manager|product owner|pm\b/.test(titleLc) ? "Product" :
      /people|hr|recruit|talent/.test(titleLc) ? "People" :
      "Operations";
    const jdText = role?.description || "";
    const roleTitle = role?.title || "New Hire";
    const fullName = candidate.preferred_name || body.preferred_name || candidate.name || "New Hire";
    const startDate = body.start_date || candidate.start_date || ymd(addDays(new Date(), 14));
    const hiringManagerId = body.hiring_manager_id || candidate.hiring_manager_id || user.id;
    const employmentType = body.employment_type || candidate.employment_type || "full_time";
    const workLocation = body.work_location || candidate.work_location || "hybrid";

    // Update candidate hire metadata
    await admin.from("candidates").update({
      status: "hired",
      hired_at: new Date().toISOString(),
      start_date: startDate,
      hiring_manager_id: hiringManagerId,
      employment_type: employmentType,
      work_location: workLocation,
      preferred_name: candidate.preferred_name || body.preferred_name || null,
    }).eq("id", candidate.id);

    // Create onboarding_runs row
    const { data: runRow } = await admin.from("onboarding_runs").insert({
      candidate_id: candidate.id,
      status: "provisioning",
      stages: {},
      triggered_by: user.id,
    }).select("id").single();
    const runId = runRow?.id;

    const stages: Record<string, any> = {};

    // ── 1. Generate Role Access Matrix tasks (default + AI-suggested) ──
    let provisioningTools: string[] = [];
    const { data: defaults } = await admin
      .from("role_access_defaults")
      .select("tools")
      .eq("department", department)
      .limit(1)
      .maybeSingle();
    if (defaults?.tools && Array.isArray(defaults.tools)) {
      provisioningTools = defaults.tools as string[];
    }
    // Augment with AI suggestions based on JD
    if (jdText && Deno.env.get("OPENAI_API_KEY")) {
      try {
        const ai = await callOpenAI([
          { role: "system", content: "Suggest 3-6 additional tools/accounts a new hire likely needs based on their job description. Return JSON only." },
          { role: "user", content: `Role: ${roleTitle}\nDepartment: ${department}\nJD excerpt:\n${jdText.slice(0, 2000)}\n\nReturn JSON: {"extra_tools": ["..."]}` },
        ]);
        const txt = ai?.choices?.[0]?.message?.content || "";
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (Array.isArray(parsed.extra_tools)) {
            for (const t of parsed.extra_tools) {
              if (typeof t === "string" && !provisioningTools.includes(t)) provisioningTools.push(t);
            }
          }
        }
      } catch (e) { console.warn("AI tool suggest failed", e); }
    }
    stages.provisioning_tools = provisioningTools;

    // ── 2. Create workstream card ──
    const start = new Date(startDate + "T09:00:00Z");
    const { data: card, error: cardErr } = await admin
      .from("workstream_cards")
      .insert({
        title: `Onboard: ${fullName}`,
        description: `Onboarding for ${fullName} — ${roleTitle} (${department}).\nStart date: ${startDate}\nEmployment: ${employmentType}\nLocation: ${workLocation}\nCandidate ID: ${candidate.id}`,
        status: "amber",
        priority: "high",
        project_tag: "Onboarding",
        owner_id: hiringManagerId,
        due_date: ymd(addDays(start, 90)),
        created_by: user.id,
      })
      .select("id")
      .single();
    if (cardErr || !card) {
      await admin.from("onboarding_runs").update({ status: "failed", error: cardErr?.message || "card creation failed" }).eq("id", runId);
      return new Response(JSON.stringify({ error: "Failed to create card", details: cardErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("candidates").update({ onboarding_card_id: card.id }).eq("id", candidate.id);
    await admin.from("onboarding_runs").update({ card_id: card.id }).eq("id", runId);

    // Assignees: hiring manager + creator (if different)
    const assignees = new Set<string>([hiringManagerId, user.id]);
    await admin.from("workstream_card_assignees").insert(
      Array.from(assignees).map((uid) => ({ card_id: card.id, user_id: uid }))
    );

    await admin.from("workstream_activity").insert({
      card_id: card.id,
      user_id: user.id,
      action: "created",
      details: { source: "trigger-onboarding", candidate_id: candidate.id, role: roleTitle },
    });

    // ── 3. Build tasks ──
    const tasks: Task[] = [
      // Pre-boarding (before start)
      { group: "Pre-boarding", title: "Send welcome email + offer letter", offsetDays: -7, assignee: user.id },
      ...provisioningTools.map((t) => ({ group: "Pre-boarding", title: `Provision access: ${t}`, offsetDays: -3, assignee: null as any })),
      { group: "Pre-boarding", title: "Order equipment / confirm remote setup", offsetDays: -5, assignee: hiringManagerId },
      { group: "Pre-boarding", title: `Add to Slack: #general and #${department.toLowerCase().replace(/\s+/g, "-")}`, offsetDays: -1, assignee: null },

      // Day 1
      { group: "Day 1", title: "Day-1 orientation (90 min)", offsetDays: 0, assignee: hiringManagerId },
      { group: "Day 1", title: "Manager intro 1:1 (30 min)", offsetDays: 0, assignee: hiringManagerId },
      { group: "Day 1", title: "Sign policy acknowledgements (handbook, security, IP)", offsetDays: 0, assignee: null },
      { group: "Day 1", title: "Device & security check", offsetDays: 0, assignee: null },

      // Week 1
      { group: "Week 1", title: "Leadership intros — schedule 15-30 min with each leader (within 10 working days)", offsetDays: 5, assignee: hiringManagerId },
      { group: "Week 1", title: "Shadow 2 team meetings", offsetDays: 5, assignee: hiringManagerId },
      { group: "Week 1", title: "Complete required training modules", offsetDays: 5, assignee: null },

      // Weeks 2-4
      { group: "Weeks 2-4", title: "Weekly manager 1:1 (recurring, 30 min × 4)", offsetDays: 7, assignee: hiringManagerId },
      { group: "Weeks 2-4", title: "Scope first deliverable with manager", offsetDays: 10, assignee: hiringManagerId },
      { group: "Weeks 2-4", title: "Review and finalize 30/60/90-day plan", offsetDays: 14, assignee: hiringManagerId },

      // Day 30 / 90
      { group: "Day 30 review", title: "Manager review against 30-day plan", offsetDays: 30, assignee: hiringManagerId },
      { group: "Day 30 review", title: "New hire 30-day self-reflection", offsetDays: 30, assignee: null },
      { group: "Day 90 review", title: "Manager review against 90-day plan", offsetDays: 90, assignee: hiringManagerId },
      { group: "Day 90 review", title: "Confirm probation outcome", offsetDays: 90, assignee: hiringManagerId },
    ];

    const taskRows = tasks.map((t, i) => ({
      card_id: card.id,
      title: `[${t.group}] ${t.title}`,
      description: "",
      assignee_id: t.assignee || null,
      due_date: t.offsetDays != null ? ymd(addDays(start, t.offsetDays)) : null,
      sort_order: i,
      completed: false,
    }));
    await admin.from("workstream_tasks").insert(taskRows);
    stages.tasks_created = taskRows.length;

    // ── 4. Welcome email (via gmail-api with the triggering user's tokens) ──
    let emailResult: any = { sent: false };
    if (candidate.email) {
      try {
        const startNice = new Date(startDate + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const emailBody =
`Hi ${fullName.split(" ")[0]},

Welcome to the team! We're thrilled to have you joining us as ${roleTitle}.

Your start date is ${startNice}. Ahead of Day 1 we'll be in touch with:
  • Day-1 orientation logistics (90 min, morning of your first day)
  • Account provisioning for the tools you'll need
  • A welcome from your hiring manager

If you have any questions before then, just reply to this email.

Looking forward to working with you.

The Team`;

        const sendRes = await admin.functions.invoke("gmail-api", {
          body: {
            action: "send",
            to: candidate.email,
            subject: `Welcome to the team, ${fullName.split(" ")[0]} — start date ${startDate}`,
            body: emailBody,
          },
          headers: { Authorization: authHeader },
        });
        emailResult = { sent: !sendRes.error, error: sendRes.error?.message, messageId: (sendRes.data as any)?.messageId };
      } catch (e: any) {
        emailResult = { sent: false, error: e?.message };
      }
    } else {
      emailResult = { sent: false, error: "no candidate email on file" };
    }
    stages.welcome_email = emailResult;

    // ── 5. Calendar events — using HIRING MANAGER's calendar tokens ──
    const calendarEvents: any[] = [];
    const { data: tokenRow } = await admin
      .from("google_calendar_tokens")
      .select("*")
      .eq("user_id", hiringManagerId)
      .maybeSingle();

    if (tokenRow) {
      const accessToken = await refreshGoogleToken(admin, tokenRow);
      if (accessToken) {
        const mgrProfile = await admin.from("profiles").select("email").eq("id", hiringManagerId).maybeSingle();
        const attendees: any[] = [];
        if (candidate.email) attendees.push({ email: candidate.email });
        if (mgrProfile.data?.email) attendees.push({ email: mgrProfile.data.email });

        const events = [
          {
            summary: `Day-1 Orientation — ${fullName}`,
            start: { dateTime: new Date(startDate + "T09:30:00Z").toISOString(), timeZone: "UTC" },
            end:   { dateTime: new Date(startDate + "T11:00:00Z").toISOString(), timeZone: "UTC" },
            description: `Day-1 orientation for ${fullName}.\nOnboarding card: ${card.id}`,
            attendees,
          },
          {
            summary: `Manager 1:1 — ${fullName}`,
            start: { dateTime: new Date(startDate + "T14:00:00Z").toISOString(), timeZone: "UTC" },
            end:   { dateTime: new Date(startDate + "T14:30:00Z").toISOString(), timeZone: "UTC" },
            description: `First manager 1:1 with ${fullName}. Weekly recurring for 4 weeks.\nOnboarding card: ${card.id}`,
            attendees,
            recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"],
          },
          {
            summary: `30-Day Review — ${fullName}`,
            start: { dateTime: new Date(ymd(addDays(start, 30)) + "T14:00:00Z").toISOString(), timeZone: "UTC" },
            end:   { dateTime: new Date(ymd(addDays(start, 30)) + "T15:00:00Z").toISOString(), timeZone: "UTC" },
            description: `30-day review with ${fullName}.\nOnboarding card: ${card.id}`,
            attendees,
          },
          {
            summary: `90-Day Review — ${fullName}`,
            start: { dateTime: new Date(ymd(addDays(start, 90)) + "T14:00:00Z").toISOString(), timeZone: "UTC" },
            end:   { dateTime: new Date(ymd(addDays(start, 90)) + "T15:00:00Z").toISOString(), timeZone: "UTC" },
            description: `90-day review and probation outcome with ${fullName}.\nOnboarding card: ${card.id}`,
            attendees,
          },
        ];

        for (const ev of events) {
          try {
            const r = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?sendUpdates=all`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(ev),
            });
            if (r.ok) {
              const j = await r.json();
              calendarEvents.push({ summary: ev.summary, id: j.id, htmlLink: j.htmlLink });
            } else {
              const t = await r.text();
              calendarEvents.push({ summary: ev.summary, error: t });
            }
          } catch (e: any) {
            calendarEvents.push({ summary: ev.summary, error: e?.message });
          }
        }
      } else {
        calendarEvents.push({ error: "Could not refresh hiring manager's Google Calendar token" });
      }
    } else {
      calendarEvents.push({ error: "Hiring manager has not connected Google Calendar — events skipped" });
    }
    stages.calendar_events = calendarEvents;

    // ── 6. 30/60/90 plan via AI ──
    let plan: any = null;
    if (Deno.env.get("OPENAI_API_KEY")) {
      try {
        const ai = await callOpenAI([
          { role: "system", content: "You draft thoughtful 30/60/90-day onboarding plans for new hires. Output strict JSON only — no prose." },
          { role: "user", content:
            `Draft a 30/60/90-day plan for a new hire.\nRole: ${roleTitle}\nDepartment: ${department}\nJob description:\n${(jdText).slice(0, 3000)}\n\nReturn JSON shape:\n{\n  "days_30": {"learning_goals":[],"intros":[],"first_deliverable":""},\n  "days_60": {"ownership_areas":[],"kpis":[],"stakeholders":[]},\n  "days_90": {"ownership_areas":[],"kpis":[],"stakeholders":[],"probation_criteria":[]}\n}`,
          },
        ]);
        const txt = ai?.choices?.[0]?.message?.content || "";
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) plan = JSON.parse(m[0]);
      } catch (e) { console.warn("plan gen failed", e); }
    }

    // ── 7. Finalise run ──
    await admin.from("onboarding_runs").update({
      status: "completed",
      stages,
      plan_30_60_90: plan,
    }).eq("id", runId);

    // ── 8. Notification ──
    try {
      await admin.from("notifications").insert({
        user_id: hiringManagerId,
        title: `Onboarding started for ${fullName}`,
        body: `Card created with ${taskRows.length} tasks. Welcome email ${emailResult.sent ? "sent" : "not sent"}. ${calendarEvents.filter((e) => e.id).length} calendar events created.`,
        link: `/workstreams?card=${card.id}`,
        kind: "onboarding",
      });
    } catch (e) { console.warn("notification insert failed", e); }

    return new Response(JSON.stringify({
      success: true,
      card_id: card.id,
      run_id: runId,
      tasks_created: taskRows.length,
      welcome_email: emailResult,
      calendar_events: calendarEvents,
      plan_generated: !!plan,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("trigger-onboarding error", err);
    return new Response(JSON.stringify({ error: err?.message || "unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
