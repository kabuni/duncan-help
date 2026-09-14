import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_OPERATIONS = ["create_position", "delete_position", "send_invite"] as const;
type Operation = (typeof ALLOWED_OPERATIONS)[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Only recruitment-privileged users may enqueue Hireflix operations.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const allowed = (roles ?? []).some((r: { role: string }) =>
      r.role === "admin" || r.role === "recruitment_admin"
    );
    if (!allowed) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const operation = body?.operation as Operation;
    const payload = body?.payload;
    const supersedeId = typeof body?.supersede_id === "string" ? body.supersede_id : null;

    if (!ALLOWED_OPERATIONS.includes(operation)) {
      return json({ error: "Invalid operation" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: "Invalid payload" }, 400);
    }

    // Validate payload shape per operation, and that referenced records exist.
    let safePayload: Record<string, unknown>;
    if (operation === "create_position") {
      const jobRoleId = payload.job_role_id;
      if (typeof jobRoleId !== "string" || typeof payload.title !== "string") {
        return json({ error: "job_role_id and title are required" }, 400);
      }
      const { data: role } = await supabaseAdmin
        .from("job_roles")
        .select("id, title, competencies")
        .eq("id", jobRoleId)
        .maybeSingle();
      if (!role) return json({ error: "Job role not found" }, 404);
      safePayload = {
        job_role_id: role.id,
        title: role.title ?? payload.title,
        competencies: role.competencies ?? [],
      };
    } else if (operation === "delete_position") {
      if (typeof payload.hireflix_position_id !== "string" || !payload.hireflix_position_id) {
        return json({ error: "hireflix_position_id is required" }, 400);
      }
      safePayload = { hireflix_position_id: payload.hireflix_position_id };
    } else {
      const candidateId = payload.candidate_id;
      if (typeof candidateId !== "string") return json({ error: "candidate_id is required" }, 400);
      const { data: candidate } = await supabaseAdmin
        .from("candidates")
        .select("id, name, email")
        .eq("id", candidateId)
        .maybeSingle();
      if (!candidate) return json({ error: "Candidate not found" }, 404);
      safePayload = {
        candidate_id: candidate.id,
        candidate_name: candidate.name,
        candidate_email: candidate.email,
        position_id: typeof payload.position_id === "string" ? payload.position_id : null,
      };
    }

    if (supersedeId) {
      await supabaseAdmin
        .from("hireflix_retry_queue")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", supersedeId);
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("hireflix_retry_queue")
      .insert({
        operation,
        payload: safePayload,
        status: "pending",
        next_retry_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to enqueue Hireflix retry:", error.message);
      return json({ error: error.message }, 500);
    }

    return json({ success: true, id: inserted.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("hireflix-enqueue-retry error:", message);
    return json({ error: message }, 500);
  }
});
