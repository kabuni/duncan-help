// People & Culture metrics — reads the employee survey Google Sheet
// (https://docs.google.com/spreadsheets/d/1Z7ISZvDwt1BdrAgzq80ULXXBdVp-MGamHTtGqwSbzNs)
// using Duncan's Gmail OAuth token (has sheets.readonly scope), same pattern as sync-social-stats.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SPREADSHEET_ID = "1Z7ISZvDwt1BdrAgzq80ULXXBdVp-MGamHTtGqwSbzNs";

async function getAccessToken(admin: any): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const { data: t } = await admin
    .from("gmail_tokens").select("*").eq("email_address", "duncan@kabuni.com").maybeSingle();
  if (!t) return null;

  if (new Date(t.token_expiry) <= new Date()) {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: t.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!r.ok) return null;
    const nt = await r.json();
    await admin.from("gmail_tokens").update({
      access_token: nt.access_token,
      token_expiry: new Date(Date.now() + nt.expires_in * 1000).toISOString(),
    }).eq("id", t.id);
    return nt.access_token;
  }
  return t.access_token;
}

function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && isFinite(v)) return v;
  const m = String(v).trim().match(/^-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return isFinite(n) ? n : null;
}

// --- Agentic theme derivation -------------------------------------------------
// Survey questions are classified into stable culture themes so leadership sees
// indices ("Wellbeing & Workload: 64") rather than raw question wording.
const THEMES: { key: string; label: string; description: string; patterns: RegExp }[] = [
  { key: "engagement", label: "Engagement & Motivation", description: "Energy, pride and discretionary effort",
    patterns: /motivat|engag|proud|energis|energiz|enjoy|look forward|meaning|purpose/i },
  { key: "enablement", label: "Enablement", description: "Tools, information and clarity to do the job",
    patterns: /tool|resource|information|equip|enable|clear|clarity|understand|priorit|process/i },
  { key: "wellbeing", label: "Wellbeing & Workload", description: "Sustainable pace, balance and stress",
    patterns: /workload|balance|stress|burn|hours|pace|pressure|wellbeing|well-being|health|time off/i },
  { key: "growth", label: "Growth & Development", description: "Learning, progression and career path",
    patterns: /grow|develop|career|learn|train|progress|promot|skill|feedback on my/i },
  { key: "leadership", label: "Leadership & Trust", description: "Confidence in leadership and transparency",
    patterns: /leader|manager|management|trust|direction|strategy|communicat|transparen|listen/i },
  { key: "belonging", label: "Belonging & Inclusion", description: "Psychological safety, respect and team connection",
    patterns: /belong|inclus|respect|safe|voice|team|colleague|culture|diverse|opinion/i },
  { key: "recognition", label: "Recognition & Reward", description: "Being valued, recognised and fairly rewarded",
    patterns: /recogni|valued|apprecia|reward|pay|salary|compensat|fair/i },
];

function classify(question: string): { key: string; label: string; description: string } {
  for (const t of THEMES) if (t.patterns.test(question)) return { key: t.key, label: t.label, description: t.description };
  return { key: "other", label: "Other Signals", description: "Questions not mapped to a core culture theme" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = await getAccessToken(admin);
    if (!token) {
      return new Response(JSON.stringify({ error: "Google not connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metaRes = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}?fields=sheets.properties(title)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      const t = await metaRes.text();
      console.error("[people-culture-metrics] metadata failed", metaRes.status, t);
      return new Response(JSON.stringify({ error: `Sheets metadata failed: ${t}`, status: metaRes.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const meta = await metaRes.json();
    const tab: string = meta.sheets?.[0]?.properties?.title ?? "Form Responses 1";

    const valsRes = await fetch(
      `${SHEETS_API}/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${tab}'!A1:BZ5000`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!valsRes.ok) {
      const t = await valsRes.text();
      return new Response(JSON.stringify({ error: `Sheets values failed: ${t}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rows: any[][] = (await valsRes.json()).values || [];
    if (rows.length < 2) {
      return new Response(JSON.stringify({ ok: true, responses: 0, metrics: [], tab }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const header = (rows[0] || []).map((h) => String(h ?? "").trim());
    const data = rows.slice(1).filter((r) => r && r.some((c) => c !== "" && c !== null && c !== undefined));

    // Timestamp column (Google Forms always writes it first)
    const tsIdx = header.findIndex((h) => /timestamp|date submitted|submitted/i.test(h));
    let lastResponse: string | null = null;
    if (tsIdx >= 0) {
      const vals = data.map((r) => new Date(String(r[tsIdx] ?? ""))).filter((d) => !isNaN(d.getTime()));
      if (vals.length) lastResponse = new Date(Math.max(...vals.map((d) => d.getTime()))).toISOString();
    }

    // Numeric (Likert / rating) questions
    const metrics: {
      question: string; average: number; scaleMax: number; normalised: number; responses: number;
    }[] = [];

    header.forEach((q, i) => {
      if (i === tsIdx || !q) return;
      const nums = data.map((r) => toNum(r[i])).filter((n): n is number => n !== null);
      if (nums.length < Math.max(2, data.length * 0.4)) return; // mostly free text -> skip
      const max = Math.max(...nums);
      const min = Math.min(...nums);
      if (max > 10 || min < 0) return; // not a rating scale
      const scaleMax = max <= 5 ? 5 : 10;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      metrics.push({
        question: q,
        average: Math.round(avg * 10) / 10,
        scaleMax,
        normalised: Math.round((avg / scaleMax) * 1000) / 10,
        responses: nums.length,
      });
    });

    // eNPS from a 0-10 recommend/likelihood question, if present
    let enps: number | null = null;
    const enpsIdx = header.findIndex((h) => /recommend|nps|likely/i.test(h));
    if (enpsIdx >= 0) {
      const nums = data.map((r) => toNum(r[enpsIdx])).filter((n): n is number => n !== null);
      if (nums.length && Math.max(...nums) <= 10) {
        const prom = nums.filter((n) => n >= 9).length;
        const det = nums.filter((n) => n <= 6).length;
        enps = Math.round(((prom - det) / nums.length) * 100);
      }
    }

    // Roll individual questions up into culture themes
    const buckets = new Map<string, { key: string; label: string; description: string; values: number[]; questions: number }>();
    for (const m of metrics) {
      const t = classify(m.question);
      const b = buckets.get(t.key) ?? { ...t, values: [], questions: 0 };
      b.values.push(m.normalised);
      b.questions += 1;
      buckets.set(t.key, b);
    }
    const themes = [...buckets.values()].map((b) => ({
      key: b.key,
      label: b.label,
      description: b.description,
      score: Math.round((b.values.reduce((a, v) => a + v, 0) / b.values.length) * 10) / 10,
      questions: b.questions,
    })).sort((a, b) => a.score - b.score);

    const strength = themes.length ? themes[themes.length - 1] : null;
    const risk = themes.length ? themes[0] : null;

    const overall = metrics.length
      ? Math.round((metrics.reduce((a, m) => a + m.normalised, 0) / metrics.length) * 10) / 10
      : null;

    return new Response(JSON.stringify({
      ok: true,
      tab,
      responses: data.length,
      lastResponse,
      overall,          // 0-100 sentiment index
      enps,
      metrics,
      themes,
      strength,
      risk,
      questions: header.filter((h, i) => h && i !== tsIdx),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[people-culture-metrics]", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
