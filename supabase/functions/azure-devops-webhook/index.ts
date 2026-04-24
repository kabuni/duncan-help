import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();

    // Azure DevOps sends webhooks with eventType
    const eventType = payload.eventType || payload.EventType || "unknown";
    const resource = payload.resource || {};

    // Log audit
    await supabaseAdmin.from("integration_audit_logs").insert({
      integration: "azure-devops",
      action: `webhook:${eventType}`,
      details: { event_type: eventType, resource_id: resource.id },
    });

    // Handle work item events
    if (eventType.startsWith("workitem.")) {
      const fields = resource.fields || resource.revision?.fields || {};
      const workItemId = resource.workItemId || resource.id || resource.revision?.id;

      if (workItemId) {
        await supabaseAdmin.from("azure_work_items").upsert(
          {
            external_id: workItemId,
            title: fields["System.Title"] || "Untitled",
            state: fields["System.State"],
            work_item_type: fields["System.WorkItemType"],
            assigned_to: fields["System.AssignedTo"]?.displayName || fields["System.AssignedTo"] || null,
            area_path: fields["System.AreaPath"],
            iteration_path: fields["System.IterationPath"],
            priority: fields["Microsoft.VSTS.Common.Priority"],
            tags: fields["System.Tags"],
            description: (fields["System.Description"] || "").substring(0, 5000),
            created_date: fields["System.CreatedDate"],
            changed_date: fields["System.ChangedDate"],
            project_name: resource.revision?.fields?.["System.TeamProject"] || null,
            raw_data: payload,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "external_id,project_name" }
        );
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Azure DevOps webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
