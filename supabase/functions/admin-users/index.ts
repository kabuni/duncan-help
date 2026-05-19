import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Admin only" }, 403);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action ?? "list";

    if (action === "list") {
      // List all auth users + profile info
      const { data: usersList, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listErr) return json({ error: listErr.message }, 500);

      const ids = usersList.users.map((u) => u.id);
      const { data: profiles } = await admin
        .from("profiles")
        .select("user_id, display_name, department, role_title, approval_status")
        .in("user_id", ids);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      const now = Date.now();
      const rows = usersList.users.map((u) => {
        const p: any = profileMap.get(u.id) ?? {};
        const lastSeen = u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : null;
        const ref = lastSeen ?? (u.created_at ? new Date(u.created_at).getTime() : now);
        return {
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          days_inactive: Math.floor((now - ref) / 86400000),
          display_name: p.display_name ?? null,
          department: p.department ?? null,
          role_title: p.role_title ?? null,
          approval_status: p.approval_status ?? null,
        };
      });
      rows.sort((a, b) => (b.days_inactive ?? 0) - (a.days_inactive ?? 0));
      return json({ users: rows });
    }

    if (action === "delete") {
      const userIds: string[] = Array.isArray(body.userIds) ? body.userIds : [];
      if (userIds.length === 0) return json({ error: "userIds required" }, 400);
      if (userIds.includes(user.id)) return json({ error: "Cannot delete your own account" }, 400);
      if (userIds.length > 100) return json({ error: "Max 100 users per request" }, 400);

      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const uid of userIds) {
        const { error } = await admin.auth.admin.deleteUser(uid);
        if (error) results.push({ id: uid, ok: false, error: error.message });
        else results.push({ id: uid, ok: true });
      }
      return json({
        deleted: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
