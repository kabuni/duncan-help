import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_CALENDAR_NAME = "Duncan | Planner";
const MANDATORY = ["owner", "objective", "success_metric", "decision_needed", "linked_docs", "risks", "next_action"];

interface ParsedEvent {
  category: string | null;
  event_name: string;
  owner: string | null;
  objective: string | null;
  success_metric: string | null;
  decision_needed: string | null;
  linked_docs: string[];
  risks: string | null;
  next_action: string | null;
}

function parseTitle(title: string): { category: string | null; event_name: string } {
  const m = title.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (m) return { category: m[1].trim(), event_name: m[2].trim() || title };
  return { category: null, event_name: title };
}

function parseDescription(desc: string | null): Omit<ParsedEvent, "category" | "event_name"> {
  const empty = {
    owner: null, objective: null, success_metric: null, decision_needed: null,
    linked_docs: [] as string[], risks: null, next_action: null,
  };
  if (!desc) return empty;

  // Strip HTML tags Google sometimes wraps descriptions in.
  const text = desc.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");

  const labels: Record<string, keyof typeof empty> = {
    "owner": "owner",
    "objective": "objective",
    "success metric": "success_metric",
    "success metrics": "success_metric",
    "decision needed": "decision_needed",
    "decisions needed": "decision_needed",
    "linked docs": "linked_docs",
    "linked doc": "linked_docs",
    "links": "linked_docs",
    "risks": "risks",
    "risk": "risks",
    "next action": "next_action",
    "next actions": "next_action",
    "next steps": "next_action",
  };

  // Tokenise into "label: value" segments.
  const labelPattern = Object.keys(labels)
    .sort((a, b) => b.length - a.length)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`(?:^|\\n)\\s*(${labelPattern})\\s*[:\\-]\\s*([\\s\\S]*?)(?=(?:\\n\\s*(?:${labelPattern})\\s*[:\\-])|$)`, "gi");

  const out: any = { ...empty };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].toLowerCase().trim();
    const value = m[2].trim();
    const field = labels[label];
    if (!field) continue;
    if (field === "linked_docs") {
      const urls = Array.from(value.matchAll(/https?:\/\/[^\s)]+/g)).map((x) => x[0]);
      out.linked_docs = urls.length > 0 ? urls : value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    } else {
      out[field] = value || null;
    }
  }
  return out;
}

function deriveRisk(parsed: ParsedEvent, missing: string[], startAt: Date | null): { risk_level: string; risk_reason: string | null } {
  const now = new Date();
  const daysUntil = startAt ? (startAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) : Infinity;
  const explicitRisk = (parsed.risks || "").toLowerCase();
  const hasBlocker = /blocker|critical|at risk|delayed|slipping|red/.test(explicitRisk);

  if (missing.includes("owner") || missing.includes("next_action")) {
    return { risk_level: "red", risk_reason: `Missing ${missing.includes("owner") ? "owner" : "next action"}` };
  }
  if (hasBlocker) return { risk_level: "red", risk_reason: "Risk note flags a blocker" };
  if (startAt && daysUntil <= 14 && missing.length > 0) {
    return { risk_level: "red", risk_reason: `Starts in ${Math.round(daysUntil)}d with ${missing.length} field(s) missing` };
  }
  if (missing.length > 0) {
    return { risk_level: "amber", risk_reason: `Missing: ${missing.join(", ")}` };
  }
  if (startAt && daysUntil <= 30 && (parsed.risks || "").length > 0) {
    return { risk_level: "amber", risk_reason: "Risks noted within 30 days" };
  }
  return { risk_level: "green", risk_reason: null };
}

function linkGoals(parsed: ParsedEvent, title: string, goals: { id: string; name: string; description: string | null }[]): string[] {
  const blob = `${title}\n${parsed.objective || ""}\n${parsed.success_metric || ""}`.toLowerCase();
  const matched: string[] = [];
  for (const g of goals) {
    const tokens = [g.name, ...(g.description || "").split(/[,;]/)].map((s) => s.toLowerCase().trim()).filter(Boolean);
    // Specific keyword anchors per known goal
    const anchors: string[] = [g.name.toLowerCase()];
    if (/june 7/.test(g.name.toLowerCase())) anchors.push("launch", "june 7", "go-live");
    if (/k10/.test(g.name.toLowerCase())) anchors.push("k10", "registration");
    if (/pre.?order/.test(g.name.toLowerCase())) anchors.push("preorder", "pre-order", "pre order");
    if (/fundrais/.test(g.name.toLowerCase())) anchors.push("fundrais", "investor", "round", "term sheet", "vc");
    if (/product delivery|delivery/.test(g.name.toLowerCase())) anchors.push("product", "ship", "release", "delivery");
    const combined = [...tokens, ...anchors];
    if (combined.some((t) => t.length > 2 && blob.includes(t))) matched.push(g.id);
  }
  return Array.from(new Set(matched));
}

async function refreshAccessToken(supaAdmin: any, tokenRow: any) {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${await res.text()}`);
  const j = await res.json();
  const newExpiry = new Date(Date.now() + (j.expires_in as number) * 1000).toISOString();
  await supaAdmin.from("duncan_calendar_tokens").update({
    access_token: j.access_token,
    token_expiry: newExpiry,
  }).eq("id", tokenRow.id);
  return j.access_token as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supaAdmin = createClient(supabaseUrl, serviceKey);

  const { data: logRow } = await supaAdmin
    .from("key_event_sync_log")
    .insert({ status: "running" })
    .select()
    .single();

  try {
    const { data: tokenRow } = await supaAdmin
      .from("duncan_calendar_tokens")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!tokenRow) {
      await supaAdmin.from("key_event_sync_log").update({
        status: "error", error: "Duncan calendar not connected", finished_at: new Date().toISOString(),
      }).eq("id", logRow.id);
      return new Response(JSON.stringify({ error: "Not connected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tokenRow.access_token as string;
    if (new Date(tokenRow.token_expiry) <= new Date(Date.now() + 60_000)) {
      accessToken = await refreshAccessToken(supaAdmin, tokenRow);
    }

    // Resolve calendar id if not stored
    let calendarId = tokenRow.calendar_id as string | null;
    if (!calendarId) {
      const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (listRes.ok) {
        const list = await listRes.json();
        const match = (list.items || []).find((c: any) => (c.summary || "").trim().toLowerCase() === TARGET_CALENDAR_NAME.toLowerCase());
        if (match) {
          calendarId = match.id;
          await supaAdmin.from("duncan_calendar_tokens").update({ calendar_id: calendarId }).eq("id", tokenRow.id);
        }
      }
      if (!calendarId) throw new Error(`Calendar "${TARGET_CALENDAR_NAME}" not found in Duncan's account`);
    }

    // Hard scope guard
    if (!calendarId) throw new Error("No calendar id resolved");

    const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    let pageToken: string | undefined;
    const allEvents: any[] = [];
    do {
      const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      u.searchParams.set("singleEvents", "true");
      u.searchParams.set("orderBy", "startTime");
      u.searchParams.set("timeMin", timeMin);
      u.searchParams.set("timeMax", timeMax);
      u.searchParams.set("maxResults", "250");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) throw new Error(`events fetch failed: ${await r.text()}`);
      const j = await r.json();
      allEvents.push(...(j.items || []));
      pageToken = j.nextPageToken;
    } while (pageToken);

    // Load goals
    const { data: goals } = await supaAdmin
      .from("key_event_goals")
      .select("id, name, description")
      .eq("status", "active");

    // Existing google ids (skip locally-created events, prefixed with "local:")
    const { data: existing } = await supaAdmin
      .from("key_events")
      .select("google_event_id");
    const existingIds = new Set(
      (existing || [])
        .map((e: any) => e.google_event_id as string)
        .filter((id) => !id.startsWith("local:"))
    );
    const seenIds = new Set<string>();

    let upserted = 0;
    let flagged = 0;

    for (const ev of allEvents) {
      const gid = ev.id as string;
      seenIds.add(gid);
      const title = (ev.summary || "(untitled)").trim();
      const { category, event_name } = parseTitle(title);
      const parsedDesc = parseDescription(ev.description || null);
      const parsed: ParsedEvent = { category, event_name, ...parsedDesc };

      const missing = MANDATORY.filter((f) => {
        const v = (parsed as any)[f];
        if (Array.isArray(v)) return v.length === 0;
        return !v;
      });
      const isComplete = missing.length === 0;

      const startStr = ev.start?.dateTime || ev.start?.date || null;
      const endStr = ev.end?.dateTime || ev.end?.date || null;
      const allDay = !!ev.start?.date;
      const startAt = startStr ? new Date(startStr) : null;

      const { risk_level, risk_reason } = deriveRisk(parsed, missing, startAt);
      if (risk_level !== "green") flagged++;

      const linkedGoalIds = linkGoals(parsed, title, goals || []);

      const row = {
        google_event_id: gid,
        calendar_id: calendarId,
        title,
        raw_description: ev.description || null,
        start_at: startStr ? new Date(startStr).toISOString() : null,
        end_at: endStr ? new Date(endStr).toISOString() : null,
        all_day: allDay,
        location: ev.location || null,
        html_link: ev.htmlLink || null,
        organizer_email: ev.organizer?.email || null,
        attendees: ev.attendees || [],
        status: ev.status || null,

        category: parsed.category,
        event_name: parsed.event_name,
        owner: parsed.owner,
        objective: parsed.objective,
        success_metric: parsed.success_metric,
        decision_needed: parsed.decision_needed,
        linked_docs: parsed.linked_docs,
        risks: parsed.risks,
        next_action: parsed.next_action,

        missing_fields: missing,
        is_complete: isComplete,
        risk_level,
        risk_reason,
        linked_goal_ids: linkedGoalIds,
        last_classified_at: new Date().toISOString(),
        deleted_in_google: false,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supaAdmin
        .from("key_events")
        .upsert(row, { onConflict: "google_event_id" });
      if (error) {
        console.error("upsert error", gid, error);
      } else {
        upserted++;
      }
    }

    // Mark stale events
    const stale = Array.from(existingIds).filter((id) => !seenIds.has(id));
    if (stale.length > 0) {
      await supaAdmin
        .from("key_events")
        .update({ deleted_in_google: true })
        .in("google_event_id", stale);
    }

    await supaAdmin.from("key_event_sync_log").update({
      status: "success",
      finished_at: new Date().toISOString(),
      events_seen: allEvents.length,
      events_upserted: upserted,
      events_flagged: flagged,
    }).eq("id", logRow.id);

    return new Response(JSON.stringify({
      ok: true,
      events_seen: allEvents.length,
      events_upserted: upserted,
      events_flagged: flagged,
      stale: stale.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("sync error", err);
    await supaAdmin.from("key_event_sync_log").update({
      status: "error", error: String(err.message || err), finished_at: new Date().toISOString(),
    }).eq("id", logRow.id);
    return new Response(JSON.stringify({ error: err.message || "sync failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
