import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getXeroToken(supabaseAdmin: any): Promise<{ accessToken: string; tenantId: string }> {
  const { data: tokenRow } = await supabaseAdmin
    .from("xero_tokens").select("*").limit(1).maybeSingle();

  if (!tokenRow) throw new Error("Xero not connected");

  let accessToken = tokenRow.access_token;
  const expiry = new Date(tokenRow.token_expiry);

  if (expiry <= new Date(Date.now() + 5 * 60 * 1000)) {
    const clientId = Deno.env.get("XERO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    const response = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        refresh_token: tokenRow.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new Error("Xero token refresh failed");
    const tokens = await response.json();
    accessToken = tokens.access_token;
    await supabaseAdmin
      .from("xero_tokens")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || tokenRow.refresh_token,
        token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq("id", tokenRow.id);
  }

  if (!tokenRow.tenant_id) throw new Error("No Xero tenant");
  return { accessToken, tenantId: tokenRow.tenant_id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const { data: syncLog } = await supabaseAdmin
    .from("sync_logs")
    .insert({ integration: "xero", sync_type: "invoices_contacts", status: "started" })
    .select().single();

  try {
    const { accessToken, tenantId } = await getXeroToken(supabaseAdmin);

    const xeroHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    };

    let totalSynced = 0;

    // Sync invoices (paginate through all)
    let invoicePage = 1;
    let hasMoreInvoices = true;
    while (hasMoreInvoices) {
      const invoicesRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?page=${invoicePage}&pageSize=100`, {
        headers: xeroHeaders,
      });
      if (!invoicesRes.ok) break;
      const invoicesData = await invoicesRes.json();
      const invoicesList = invoicesData.Invoices || [];
      if (invoicesList.length === 0) {
        hasMoreInvoices = false;
        break;
      }
      for (const inv of invoicesList) {
        const { error } = await supabaseAdmin.from("xero_invoices").upsert(
          {
            external_id: inv.InvoiceID,
            invoice_number: inv.InvoiceNumber,
            contact_name: inv.Contact?.Name,
            contact_id: inv.Contact?.ContactID,
            type: inv.Type,
            status: inv.Status,
            date: inv.DateString,
            due_date: inv.DueDateString,
            amount_due: inv.AmountDue || 0,
            amount_paid: inv.AmountPaid || 0,
            total: inv.Total || 0,
            currency_code: inv.CurrencyCode || "GBP",
            line_items: inv.LineItems || [],
            raw_data: inv,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "external_id" }
        );
        if (!error) totalSynced++;
      }
      if (invoicesList.length < 100) {
        hasMoreInvoices = false;
      } else {
        invoicePage++;
      }
    }

    // Sync contacts (paginate through all)
    let contactPage = 1;
    let hasMoreContacts = true;
    while (hasMoreContacts) {
      const contactsRes = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?page=${contactPage}&pageSize=100`, {
        headers: xeroHeaders,
      });
      if (!contactsRes.ok) break;
      const contactsData = await contactsRes.json();
      const contactsList = contactsData.Contacts || [];
      if (contactsList.length === 0) {
        hasMoreContacts = false;
        break;
      }
      for (const c of contactsList) {
        const { error } = await supabaseAdmin.from("xero_contacts").upsert(
          {
            external_id: c.ContactID,
            name: c.Name,
            email: c.EmailAddress,
            phone: c.Phones?.[0]?.PhoneNumber,
            is_supplier: c.IsSupplier || false,
            is_customer: c.IsCustomer || false,
            contact_status: c.ContactStatus,
            outstanding_balance: c.Balances?.AccountsReceivable?.Outstanding || 0,
            overdue_balance: c.Balances?.AccountsReceivable?.Overdue || 0,
            raw_data: c,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "external_id" }
        );
        if (!error) totalSynced++;
      }
      if (contactsList.length < 100) {
        hasMoreContacts = false;
      } else {
        contactPage++;
      }
    }

    await supabaseAdmin
      .from("sync_logs")
      .update({ status: "completed", records_synced: totalSynced, completed_at: new Date().toISOString() })
      .eq("id", syncLog?.id);

    await supabaseAdmin.from("company_integrations").upsert(
      { integration_id: "xero", status: "connected", last_sync: new Date().toISOString(), documents_ingested: totalSynced },
      { onConflict: "integration_id" }
    );

    return new Response(JSON.stringify({ success: true, records_synced: totalSynced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Xero sync error:", error);
    await supabaseAdmin
      .from("sync_logs")
      .update({ status: "failed", error_message: error.message, completed_at: new Date().toISOString() })
      .eq("id", syncLog?.id);

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
