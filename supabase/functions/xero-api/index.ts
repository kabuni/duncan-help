import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function refreshXeroToken(supabaseAdmin: any, tokenRow: any): Promise<string> {
  const expiry = new Date(tokenRow.token_expiry);
  if (expiry > new Date(Date.now() + 5 * 60 * 1000)) {
    return tokenRow.access_token;
  }

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

  if (!response.ok) throw new Error(`Xero token refresh failed: ${await response.text()}`);

  const tokens = await response.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);

  await supabaseAdmin
    .from("xero_tokens")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokenRow.refresh_token,
      token_expiry: newExpiry.toISOString(),
    })
    .eq("id", tokenRow.id);

  return tokens.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get token
    const { data: tokenRow } = await supabaseAdmin
      .from("xero_tokens").select("*").limit(1).maybeSingle();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "Xero not connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshXeroToken(supabaseAdmin, tokenRow);
    const tenantId = tokenRow.tenant_id;

    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No Xero tenant connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, invoiceId, contactId, reportId, modifiedAfter } = body;

    const xeroHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    };

    // --- CREATE INVOICE (POST) ---
    if (action === "create_invoice") {
      const { invoice } = body;
      if (!invoice) {
        return new Response(JSON.stringify({ error: "Missing invoice object" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const createRes = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
        method: "POST",
        headers: {
          ...xeroHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ Invoices: [invoice] }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        console.error("Xero create invoice error:", JSON.stringify(createData));
        return new Response(JSON.stringify({ error: "Xero API error", details: createData }), {
          status: createRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(createData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- CREATE EXPENSE (Bank Transaction - SPEND) ---
    if (action === "create_expense") {
      const { bank_transaction } = body;
      if (!bank_transaction) {
        return new Response(JSON.stringify({ error: "Missing bank_transaction object" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const createRes = await fetch("https://api.xero.com/api.xro/2.0/BankTransactions", {
        method: "POST",
        headers: {
          ...xeroHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ BankTransactions: [bank_transaction] }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        console.error("Xero create expense error:", JSON.stringify(createData));
        return new Response(JSON.stringify({ error: "Xero API error", details: createData }), {
          status: createRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(createData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- LIST BANK ACCOUNTS ---
    if (action === "list_bank_accounts") {
      const accountsRes = await fetch("https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%22BANK%22", {
        headers: xeroHeaders,
      });
      const accountsData = await accountsRes.json();
      if (!accountsRes.ok) {
        return new Response(JSON.stringify({ error: "Xero API error", details: accountsData }), {
          status: accountsRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(accountsData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- READ-ONLY ACTIONS (GET) ---
    let apiUrl: string;

    switch (action) {
      case "list_invoices":
        apiUrl = "https://api.xero.com/api.xro/2.0/Invoices";
        if (modifiedAfter) {
          xeroHeaders["If-Modified-Since"] = new Date(modifiedAfter).toUTCString();
        }
        break;
      case "get_invoice":
        apiUrl = `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`;
        break;
      case "list_contacts":
        apiUrl = "https://api.xero.com/api.xro/2.0/Contacts";
        if (modifiedAfter) {
          xeroHeaders["If-Modified-Since"] = new Date(modifiedAfter).toUTCString();
        }
        break;
      case "get_contact":
        apiUrl = `https://api.xero.com/api.xro/2.0/Contacts/${contactId}`;
        break;
      case "get_report":
        apiUrl = `https://api.xero.com/api.xro/2.0/Reports/${reportId || "BalanceSheet"}`;
        break;
      case "aged_receivables":
        apiUrl = "https://api.xero.com/api.xro/2.0/Reports/AgedReceivablesByContact";
        break;
      case "aged_payables":
        apiUrl = "https://api.xero.com/api.xro/2.0/Reports/AgedPayablesByContact";
        break;
      case "profit_and_loss":
        apiUrl = "https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss";
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const apiResponse = await fetch(apiUrl, { headers: xeroHeaders });
    const data = await apiResponse.json();

    if (!apiResponse.ok) {
      return new Response(JSON.stringify({ error: "Xero API error", details: data }), {
        status: apiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Xero API error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
