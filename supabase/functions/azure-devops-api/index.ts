import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getAuthAndOrg(supabaseAdmin: any): Promise<{ authHeader: string; orgUrl: string } | { error: string; status: number }> {
  const pat = Deno.env.get("AZURE_DEVOPS_PAT");
  if (pat) {
    const orgUrl = (Deno.env.get("AZURE_DEVOPS_ORG_URL") || "").replace(/\/+$/, "");
    if (!orgUrl) return { error: "AZURE_DEVOPS_ORG_URL not configured", status: 500 };
    return { authHeader: `Basic ${btoa(":" + pat)}`, orgUrl };
  }

  const { data: tokenRow } = await supabaseAdmin
    .from("azure_devops_tokens")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (!tokenRow) return { error: "Azure DevOps not connected", status: 400 };

  // Refresh OAuth token if needed
  let accessToken = tokenRow.access_token;
  const expiry = new Date(tokenRow.token_expiry);
  if (expiry <= new Date(Date.now() + 5 * 60 * 1000)) {
    const clientId = Deno.env.get("AZURE_DEVOPS_CLIENT_ID")!;
    const clientSecret = Deno.env.get("AZURE_DEVOPS_CLIENT_SECRET")!;
    const tenantId = Deno.env.get("AZURE_TENANT_ID") || "53e795b0-6f86-4e93-b619-32b5f5850f07";
    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: "refresh_token",
        scope: "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation offline_access",
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Token refresh failed: ${err}`);
    }
    const tokens = await response.json();
    accessToken = tokens.access_token;
    await supabaseAdmin
      .from("azure_devops_tokens")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || tokenRow.refresh_token,
        token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq("id", tokenRow.id);
  }
  const orgUrl = tokenRow.org_url || Deno.env.get("AZURE_DEVOPS_ORG_URL") || "";
  return { authHeader: `Bearer ${accessToken}`, orgUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authResult = await getAuthAndOrg(supabaseAdmin);
    if ("error" in authResult) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: authResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { authHeader: adoAuthHeader, orgUrl } = authResult;

    const { action, project, wiql, workItemId } = await req.json();

    let apiUrl: string;
    let method = "GET";
    let body: string | undefined;

    switch (action) {
      case "list_projects":
        apiUrl = `${orgUrl}/_apis/projects?api-version=7.1`;
        break;

      case "query_work_items":
        apiUrl = `${orgUrl}/${project || ""}/_apis/wit/wiql?api-version=7.1`;
        method = "POST";
        body = JSON.stringify({ query: wiql || "SELECT [System.Id], [System.Title], [System.State] FROM workitems WHERE [System.State] <> 'Closed' ORDER BY [System.ChangedDate] DESC" });
        break;

      case "get_work_item":
        apiUrl = `${orgUrl}/_apis/wit/workitems/${workItemId}?$expand=all&api-version=7.1`;
        break;

      case "get_work_items_batch": {
        const { ids } = await req.json().catch(() => ({ ids: [] }));
        const idsParam = (ids || []).join(",");
        apiUrl = `${orgUrl}/_apis/wit/workitems?ids=${idsParam}&$expand=all&api-version=7.1`;
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const apiResponse = await fetch(apiUrl, {
      method,
      headers: {
        Authorization: adoAuthHeader,
        "Content-Type": "application/json",
      },
      ...(body ? { body } : {}),
    });

    const data = await apiResponse.json();

    if (!apiResponse.ok) {
      return new Response(JSON.stringify({ error: "Azure DevOps API error", details: data }), {
        status: apiResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Azure DevOps API error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
