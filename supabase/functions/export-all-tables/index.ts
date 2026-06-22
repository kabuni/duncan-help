// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toCSV(rows: any[]): string {
  if (!rows || rows.length === 0) return "";
  const cols = Array.from(
    rows.reduce((s: Set<string>, r) => {
      Object.keys(r ?? {}).forEach((k) => s.add(k));
      return s;
    }, new Set<string>())
  );
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") v = JSON.stringify(v);
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tablesData, error: tErr } = await supabase.rpc("exec_sql_ro" as any, {}).catch(() => ({ data: null, error: "no-rpc" }));

    // Fallback: hardcoded table list query via PostgREST is not possible; use raw SQL via pg_meta? Use a direct query through a custom function: list tables.
    // We'll use information_schema via PostgREST is not possible. Use REST with a known SQL endpoint? Use supabase.from on a view? 
    // Simpler: hit the database via the Postgres connection using deno-postgres.

    const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    let tableNames: string[] = [];
    let client: any = null;
    if (dbUrl) {
      client = new Client(dbUrl);
      await client.connect();
      const res = await client.queryObject<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
      );
      tableNames = res.rows.map((r) => r.table_name);
    } else {
      return new Response(JSON.stringify({ error: "SUPABASE_DB_URL not set" }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const zip = new JSZip();
    const summary: Record<string, number> = {};
    for (const t of tableNames) {
      try {
        const r = await client.queryObject(`SELECT * FROM public."${t}"`);
        const rows = r.rows as any[];
        zip.file(`${t}.csv`, toCSV(rows));
        summary[t] = rows.length;
      } catch (e) {
        zip.file(`${t}.ERROR.txt`, String(e));
        summary[t] = -1;
      }
    }
    zip.file("_summary.json", JSON.stringify(summary, null, 2));
    await client.end();

    const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new Response(buf, {
      headers: {
        ...corsHeaders,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="duncan-db-export.zip"`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), stack: (e as Error).stack }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
