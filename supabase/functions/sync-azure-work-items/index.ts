import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Create sync log
  const { data: syncLog } = await supabaseAdmin
    .from("sync_logs")
    .insert({ integration: "azure-devops", sync_type: "work_items", status: "started" })
    .select()
    .single();

  try {
    let authHeader: string;
    let orgUrl: string;
    const pat = Deno.env.get("AZURE_DEVOPS_PAT");

    if (pat) {
      authHeader = `Basic ${btoa(":" + pat)}`;
      orgUrl = (Deno.env.get("AZURE_DEVOPS_ORG_URL") || "").replace(/\/+$/, "");
      if (!orgUrl) throw new Error("AZURE_DEVOPS_ORG_URL not configured");
    } else {
      // Get token
      const { data: tokenRow } = await supabaseAdmin
        .from("azure_devops_tokens")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (!tokenRow) {
        throw new Error("Azure DevOps not connected");
      }

      // Refresh token if needed
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
        if (!response.ok) throw new Error("Token refresh failed");
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
      authHeader = `Bearer ${accessToken}`;
      orgUrl = tokenRow.org_url || Deno.env.get("AZURE_DEVOPS_ORG_URL") || "";
    }

    // List projects
    const projectsRes = await fetch(`${orgUrl}/_apis/projects?api-version=7.1`, {
      headers: { Authorization: authHeader },
    });
    if (!projectsRes.ok) throw new Error(`Failed to list projects: ${projectsRes.status}`);
    const projectsData = await projectsRes.json();

    let totalSynced = 0;

    for (const project of projectsData.value || []) {
      const scopedProjectName = String(project.name || "").replace(/'/g, "''");

      // Query recent work items (changed in last 30 days)
      const wiqlRes = await fetch(`${orgUrl}/${project.name}/_apis/wit/wiql?api-version=7.1`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = '${scopedProjectName}' AND [System.ChangedDate] >= @Today - 30 ORDER BY [System.ChangedDate] DESC`,
        }),
      });

      if (!wiqlRes.ok) {
        console.warn(`Failed to query ${project.name}: ${wiqlRes.status}`);
        continue;
      }

      const wiqlData = await wiqlRes.json();
      const ids = (wiqlData.workItems || []).map((w: any) => w.id).slice(0, 200);
      if (ids.length === 0) continue;

      // Batch get work items (max 200 per call)
      const batchRes = await fetch(
        `${orgUrl}/_apis/wit/workitems?ids=${ids.join(",")}&$expand=all&api-version=7.1`,
        { headers: { Authorization: authHeader } }
      );

      if (!batchRes.ok) continue;
      const batchData = await batchRes.json();

      for (const item of batchData.value || []) {
        const fields = item.fields || {};
        const canonicalProjectName = fields["System.TeamProject"] || project.name;
        const { error: upsertError } = await supabaseAdmin
          .from("azure_work_items")
          .upsert(
            {
              external_id: item.id,
              title: fields["System.Title"] || "Untitled",
              state: fields["System.State"],
              work_item_type: fields["System.WorkItemType"],
              assigned_to: fields["System.AssignedTo"]?.displayName || null,
              area_path: fields["System.AreaPath"],
              iteration_path: fields["System.IterationPath"],
              release: fields["Custom.MVPRelease"] || fields["Custom.Release"] || null,
              priority: fields["Microsoft.VSTS.Common.Priority"],
              tags: fields["System.Tags"],
              description: (fields["System.Description"] || "").substring(0, 5000),
              created_date: fields["System.CreatedDate"],
              changed_date: fields["System.ChangedDate"],
              project_name: canonicalProjectName,
              raw_data: item,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "external_id,project_name" }
          );

        if (!upsertError) totalSynced++;
      }
    }

    // Update sync log
    await supabaseAdmin
      .from("sync_logs")
      .update({ status: "completed", records_synced: totalSynced, completed_at: new Date().toISOString() })
      .eq("id", syncLog?.id);

    // Update company integration
    await supabaseAdmin.from("company_integrations").upsert(
      { integration_id: "azure-devops", status: "connected", last_sync: new Date().toISOString(), documents_ingested: totalSynced },
      { onConflict: "integration_id" }
    );

    return new Response(JSON.stringify({ success: true, records_synced: totalSynced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    await supabaseAdmin
      .from("sync_logs")
      .update({ status: "failed", error_message: error.message, completed_at: new Date().toISOString() })
      .eq("id", syncLog?.id);

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
