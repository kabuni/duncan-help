import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASECAMP_TOKEN_URL = "https://launchpad.37signals.com/authorization/token";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { endpoint, method = "GET", body, paginate = false } = await req.json();

    if (!endpoint) {
      return new Response(JSON.stringify({ error: "endpoint is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch stored tokens (company-level)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("basecamp_tokens")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: "Basecamp is not connected. An admin must connect it first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let accessToken = tokenRow.access_token;

    // Refresh token if expired
    if (new Date(tokenRow.token_expiry) <= new Date()) {
      console.log("Basecamp token expired, refreshing...");
      const clientId = Deno.env.get("BASECAMP_CLIENT_ID");
      const clientSecret = Deno.env.get("BASECAMP_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        return new Response(
          JSON.stringify({ error: "Basecamp OAuth credentials not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const refreshRes = await fetch(BASECAMP_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "refresh",
          refresh_token: tokenRow.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!refreshRes.ok) {
        const errText = await refreshRes.text();
        console.error("Token refresh failed:", errText);
        return new Response(
          JSON.stringify({ error: "Failed to refresh Basecamp token. Admin may need to reconnect." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const refreshed = await refreshRes.json();
      accessToken = refreshed.access_token;

      const newExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await supabaseAdmin
        .from("basecamp_tokens")
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token || tokenRow.refresh_token,
          token_expiry: newExpiry.toISOString(),
        })
        .eq("id", tokenRow.id);

      console.log("Basecamp token refreshed successfully");
    }

    // Build the Basecamp API URL
    const accountId = tokenRow.account_id || Deno.env.get("BASECAMP_ACCOUNT_ID");
    if (!accountId) {
      return new Response(
        JSON.stringify({ error: "Basecamp account ID not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = `https://3.basecampapi.com/${accountId}`;
    const apiUrl = endpoint.startsWith("http") ? endpoint : `${baseUrl}/${endpoint}.json`;

    const basecampHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "Duncan (duncan.help)",
    };

    // If paginate is true, follow Link headers to get all pages
    if (paginate && method === "GET") {
      let allData: any[] = [];
      let nextUrl: string | null = apiUrl;

      while (nextUrl) {
        const fetchOptions: RequestInit = {
          method: "GET",
          headers: basecampHeaders,
        };

        const apiResponse = await fetch(nextUrl, fetchOptions);

        if (!apiResponse.ok) {
          const errorText = await apiResponse.text();
          console.error(`Basecamp API error [${apiResponse.status}]:`, errorText);
          return new Response(
            JSON.stringify({
              error: `Basecamp API error: ${apiResponse.status}`,
              details: errorText,
            }),
            {
              status: apiResponse.status,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const pageData = await apiResponse.json();
        if (Array.isArray(pageData)) {
          allData = allData.concat(pageData);
        } else {
          // Non-array response, return directly (no pagination for single objects)
          return new Response(JSON.stringify(pageData), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Parse Link header for next page
        const linkHeader = apiResponse.headers.get("Link");
        nextUrl = null;
        if (linkHeader) {
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (nextMatch) {
            nextUrl = nextMatch[1];
          }
        }
      }

      return new Response(JSON.stringify(allData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Standard single-page request
    const fetchOptions: RequestInit = {
      method,
      headers: basecampHeaders,
    };

    if (body && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    const apiResponse = await fetch(apiUrl, fetchOptions);

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`Basecamp API error [${apiResponse.status}]:`, errorText);
      return new Response(
        JSON.stringify({
          error: `Basecamp API error: ${apiResponse.status}`,
          details: errorText,
        }),
        {
          status: apiResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await apiResponse.json();

    // Include pagination info in response if available
    const linkHeader = apiResponse.headers.get("Link");
    let hasMore = false;
    if (linkHeader) {
      hasMore = linkHeader.includes('rel="next"');
    }

    if (hasMore) {
      return new Response(JSON.stringify({ data, has_more: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Basecamp API proxy error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
