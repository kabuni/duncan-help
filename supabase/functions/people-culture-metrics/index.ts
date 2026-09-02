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
  { key: "culture", label: "Culture & Connection", description: "Belonging, inclusion, trust in leadership and team connection",
    patterns: /belong|inclus|respect|safe|voice|team|colleague|culture|diverse|opinion|leader|manager|management|trust|transparen|listen|communicat/i },
  { key: "alignment", label: "Alignment & Growth", description: "Clarity of direction, enablement, learning and progression",
    patterns: /grow|develop|career|learn|train|progress|promot|skill|direction|strategy|goal|clear|clarity|understand|priorit|tool|resource|information|equip|enable|process|feedback/i },
  { key: "satisfaction", label: "Employee Satisfaction", description: "Engagement, wellbeing, recognition and overall happiness",
    patterns: /satisf|happy|motivat|engag|proud|energis|energiz|enjoy|look forward|meaning|purpose|workload|balance|stress|burn|hours|pace|pressure|wellbeing|well-being|health|time off|recogni|valued|apprecia|reward|pay|salary|compensat|fair/i },
];

function classify(question: string): { key: string; label: string; description: string } {
  for (const t of THEMES) if (t.patterns.test(question)) return { key: t.key, label: t.label, description: t.description };
  const f = THEMES[2];
  return { key: f.key, label: f.label, description: f.description };
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

    // Timestamp column (Google Forms always writes it first).
    // Google Forms writes DD/MM/YYYY HH:MM:SS for UK locale sheets — `new Date()`
    // would misread that as MM/DD, so parse it explicitly.
    const parseTs = (raw: any): Date | null => {
      const s = String(raw ?? "").trim();
      if (!s) return null;
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        let [, a, b, y, hh, mm, ss] = m;
        let day = Number(a), month = Number(b);
        if (day > 12 && month <= 12) { /* clearly DD/MM */ }
        else if (month > 12) { const t = day; day = month; month = t; } // was MM/DD
        const d = new Date(Date.UTC(Number(y), month - 1, day, Number(hh), Number(mm), Number(ss ?? 0)));
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    const tsIdx = header.findIndex((h) => /timestamp|date submitted|submitted/i.test(h));
    let lastResponse: string | null = null;
    if (tsIdx >= 0) {
      const vals = data.map((r) => parseTs(r[tsIdx])).filter((d): d is Date => !!d);
      if (vals.length) lastResponse = new Date(Math.max(...vals.map((d) => d.getTime()))).toISOString();
    }


    // Numeric (Likert / rating) questions
    const metrics: {
      question: string; average: number; scaleMax: number; normalised: number; responses: number;
      distribution: { value: number; count: number }[]; theme: string;
    }[] = [];
    // Free-text questions (verbatim comments)
    const comments: { question: string; answers: string[] }[] = [];
    // Single-choice / categorical questions (e.g. department, tenure)
    const breakdowns: { question: string; options: { label: string; count: number }[] }[] = [];

    header.forEach((q, i) => {
      if (i === tsIdx || !q) return;
      const raw = data.map((r) => r[i]).filter((v) => v !== "" && v !== null && v !== undefined);
      const nums = data.map((r) => toNum(r[i])).filter((n): n is number => n !== null);
      const isRating =
        nums.length >= Math.max(2, data.length * 0.4) &&
        Math.max(...(nums.length ? nums : [99])) <= 10 &&
        Math.min(...(nums.length ? nums : [-1])) >= 0;

      if (isRating) {
        const max = Math.max(...nums);
        const scaleMax = max <= 5 ? 5 : 10;
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        const counts = new Map<number, number>();
        for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
        metrics.push({
          question: q,
          average: Math.round(avg * 10) / 10,
          scaleMax,
          normalised: Math.round((avg / scaleMax) * 1000) / 10,
          responses: nums.length,
          distribution: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count })),
          theme: classify(q).key,
        });
        return;
      }

      const strings = raw.map((v) => String(v).trim()).filter(Boolean);
      if (!strings.length) return;
      const unique = new Set(strings);
      const avgLen = strings.reduce((a, s) => a + s.length, 0) / strings.length;
      if (unique.size <= Math.max(6, strings.length * 0.4) && avgLen < 40) {
        const counts = new Map<string, number>();
        for (const s of strings) counts.set(s, (counts.get(s) ?? 0) + 1);
        breakdowns.push({
          question: q,
          options: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
        });
      } else {
        comments.push({ question: q, answers: strings.slice(-100).reverse() });
      }
    });

    // eNPS from a 0-10 recommend/likelihood question, if present
    let enps: number | null = null;
    let enpsBreakdown: { promoters: number; passives: number; detractors: number; responses: number } | null = null;
    const enpsIdx = header.findIndex((h) => /recommend|nps|likely/i.test(h));
    if (enpsIdx >= 0) {
      const nums = data.map((r) => toNum(r[enpsIdx])).filter((n): n is number => n !== null);
      if (nums.length && Math.max(...nums) <= 10) {
        const prom = nums.filter((n) => n >= 9).length;
        const det = nums.filter((n) => n <= 6).length;
        enps = Math.round(((prom - det) / nums.length) * 100);
        enpsBreakdown = { promoters: prom, passives: nums.length - prom - det, detractors: det, responses: nums.length };
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

    // Submissions over time (month buckets) so leadership can see participation trend
    const timeline: { period: string; count: number }[] = [];
    if (tsIdx >= 0) {
      const counts = new Map<string, number>();
      for (const r of data) {
        const d = parseTs(r[tsIdx]);
        if (!d) continue;
        const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      timeline.push(...[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([period, count]) => ({ period, count })));
    }

    return new Response(JSON.stringify({
      ok: true,
      tab,
      responses: data.length,
      lastResponse,
      overall,          // 0-100 sentiment index
      enps,
      enpsBreakdown,
      metrics,
      themes,
      strength,
      risk,
      comments,
      breakdowns,
      timeline,
      questions: header.filter((h, i) => h && i !== tsIdx),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[people-culture-metrics]", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
