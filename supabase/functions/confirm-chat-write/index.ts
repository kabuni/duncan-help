// Phase 2: confirm-chat-write
// User-facing endpoint that the Chat UI calls when the user confirms (or cancels)
// a pending write action that originated from Duncan Chat.
//
// Flow:
//   1. Validate the caller's JWT.
//   2. Load the pending row from chat_write_pending; verify ownership + status.
//   3. If action="cancel" → mark cancelled and return.
//   4. If action="confirm" → mark confirmed, invoke norman-chat with
//      { executeWriteId } to actually run the tool, then write the result back
//      to the row and return it to the client.
//
// Idempotency: the unique (user_id, idempotency_key) index on chat_write_pending
// prevents the same logical action being queued twice within an active window.
// On the execution side, we also short-circuit if the row is already 'executed'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { pendingId, action } = body || {};
    if (typeof pendingId !== "string" || !pendingId) {
      return json({ error: "pendingId required" }, 400);
    }
    if (action !== "confirm" && action !== "cancel") {
      return json({ error: "action must be 'confirm' or 'cancel'" }, 400);
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: row, error: rowErr } = await admin
      .from("chat_write_pending")
      .select("*")
      .eq("id", pendingId)
      .maybeSingle();
    if (rowErr || !row) return json({ error: "Pending action not found" }, 404);
    if (row.user_id !== user.id) return json({ error: "Forbidden" }, 403);

    // Expire check
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await admin.from("chat_write_pending").update({ status: "expired" }).eq("id", pendingId);
      return json({ error: "This pending action has expired. Please ask Duncan to retry." }, 410);
    }

    if (action === "cancel") {
      await admin.from("chat_write_pending").update({ status: "cancelled" }).eq("id", pendingId);
      return json({ status: "cancelled" }, 200);
    }

    // Already executed? short-circuit idempotently.
    if (row.status === "executed") {
      const prior = (row.result ?? {}) as any;
      return json({
        status: "executed",
        ok: true,
        verified: true,
        alreadyExecuted: true,
        tool: row.tool_name,
        summary: row.summary ?? prior.summary ?? null,
        source: prior.source ?? row.tool_name,
        before: prior.before ?? null,
        after: prior.after ?? null,
        result: row.result,
      }, 200);
    }
    if (row.status === "cancelled" || row.status === "expired" || row.status === "failed") {
      return json({ error: `Cannot confirm: action is ${row.status}` }, 409);
    }

    // Mark as confirmed, then invoke norman-chat for execution.
    await admin
      .from("chat_write_pending")
      .update({ status: "confirmed" })
      .eq("id", pendingId)
      .eq("status", "pending");

    const execResp = await fetch(`${supabaseUrl}/functions/v1/norman-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ executeWriteId: pendingId }),
    });

    const execText = await execResp.text();
    let execJson: any = null;
    try { execJson = JSON.parse(execText); } catch { /* keep raw */ }

    if (!execResp.ok) {
      const errMsg = (execJson && execJson.error) || execText || `Execution failed (${execResp.status})`;
      await admin
        .from("chat_write_pending")
        .update({ status: "failed", error: String(errMsg).slice(0, 2000), executed_at: new Date().toISOString(), result: execJson ?? { raw: execText } })
        .eq("id", pendingId);
      return json({
        status: "failed",
        ok: false,
        verified: false,
        error: errMsg,
        result: execJson ?? { raw: execText },
      }, 502);
    }

    // Mutation Truth Rule: only mark executed when the executor verified the write.
    const verifiedOk = execJson?.ok === true && execJson?.verified === true;
    const persistedStatus = verifiedOk ? "executed" : "failed";

    await admin
      .from("chat_write_pending")
      .update({
        status: persistedStatus,
        result: execJson ?? { raw: execText },
        error: verifiedOk ? null : (execJson?.error || "Write did not verify"),
        executed_at: new Date().toISOString(),
      })
      .eq("id", pendingId);

    return json({
      status: persistedStatus,
      ok: verifiedOk,
      verified: execJson?.verified === true,
      source: execJson?.source ?? null,
      tool: execJson?.tool ?? null,
      summary: execJson?.summary ?? null,
      before: execJson?.before ?? null,
      after: execJson?.after ?? null,
      error: verifiedOk ? null : (execJson?.error || "Write did not verify"),
      result: execJson ?? { raw: execText },
    }, verifiedOk ? 200 : 502);
  } catch (e: any) {
    console.error("[confirm-chat-write] error:", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
