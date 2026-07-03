// Reject a candidate: flip status to 'rejected' and send a polite rejection
// email via the triggering user's Gmail (same auth pattern as trigger-onboarding).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Body {
  candidate_id: string;
  subject?: string;
  body?: string;
  skip_email?: boolean;
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

    const { data: candidate, error: cErr } = await admin
      .from("candidates")
      .select("id, name, email, status, job_roles(title)")
      .eq("id", body.candidate_id)
      .maybeSingle();
    if (cErr || !candidate) {
      return new Response(JSON.stringify({ error: "Candidate not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Flip status
    await admin.from("candidates").update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_by: user.id,
    }).eq("id", candidate.id);

    let emailResult: any = { sent: false };
    if (!body.skip_email && candidate.email) {
      try {
        const sendRes = await admin.functions.invoke("gmail-api", {
          body: {
            action: "send",
            to: candidate.email,
            subject: body.subject || `Update on your application at Kabuni`,
            body: body.body || defaultBody(candidate),
          },
          headers: { Authorization: authHeader },
        });
        emailResult = { sent: !sendRes.error, error: sendRes.error?.message, messageId: (sendRes.data as any)?.messageId };
      } catch (e: any) {
        emailResult = { sent: false, error: e?.message };
      }
    } else if (!candidate.email) {
      emailResult = { sent: false, error: "no candidate email on file" };
    } else {
      emailResult = { sent: false, skipped: true };
    }

    return new Response(JSON.stringify({ success: true, email: emailResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("reject-candidate error", err);
    return new Response(JSON.stringify({ error: err?.message || "unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function defaultBody(c: any): string {
  const first = (c.name || "there").split(" ")[0];
  const role = c.job_roles?.title || "the role";
  return `Hi ${first},

Thank you for applying for the ${role} position at Kabuni, and for the time you invested in the process.

After careful consideration, we've decided not to move forward with your application on this occasion. The decision was a close one, and it's no reflection on your ability.

We'll keep your details on file and would welcome you applying again for future roles that match your experience.

Wishing you the very best with your search.

Kind regards,
The Kabuni Team`;
}
