import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      throw new Error("Google Calendar credentials not configured");
    }

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
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

    // Get user's tokens
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from("google_calendar_tokens")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({ error: "Google Calendar not connected", code: "NOT_CONNECTED" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if token needs refresh
    let accessToken = tokenData.access_token;
    const tokenExpiry = new Date(tokenData.token_expiry);
    
    if (tokenExpiry <= new Date()) {
      console.log("Token expired, refreshing...");
      
      const refreshResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokenData.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!refreshResponse.ok) {
        console.error("Failed to refresh token");
        return new Response(JSON.stringify({ error: "Failed to refresh token", code: "REFRESH_FAILED" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newTokens = await refreshResponse.json();
      accessToken = newTokens.access_token;
      
      // Update stored tokens
      const newExpiry = new Date(Date.now() + (newTokens.expires_in * 1000));
      await supabaseAdmin
        .from("google_calendar_tokens")
        .update({
          access_token: accessToken,
          token_expiry: newExpiry.toISOString(),
        })
        .eq("user_id", user.id);
    }

    // Parse request body
    const { action, params } = await req.json();

    let apiUrl: string;
    let method = "GET";
    let body: string | undefined;

    switch (action) {
      case "listCalendars":
        apiUrl = `${GOOGLE_CALENDAR_API}/users/me/calendarList`;
        break;

      case "listEvents": {
        const calendarId = params?.calendarId || "primary";
        const timeMin = params?.timeMin || new Date().toISOString();
        const timeMax = params?.timeMax;
        const maxResults = params?.maxResults || 50;
        
        const eventsUrl = new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
        eventsUrl.searchParams.set("timeMin", timeMin);
        if (timeMax) eventsUrl.searchParams.set("timeMax", timeMax);
        eventsUrl.searchParams.set("maxResults", String(maxResults));
        eventsUrl.searchParams.set("singleEvents", "true");
        eventsUrl.searchParams.set("orderBy", "startTime");
        
        apiUrl = eventsUrl.toString();
        break;
      }

      case "getEvent": {
        const calendarId = params?.calendarId || "primary";
        const eventId = params?.eventId;
        if (!eventId) throw new Error("eventId is required");
        apiUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
        break;
      }

      case "createEvent": {
        const calendarId = params?.calendarId || "primary";
        apiUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
        method = "POST";
        body = JSON.stringify(params?.event);
        break;
      }

      case "updateEvent": {
        const calendarId = params?.calendarId || "primary";
        const eventId = params?.eventId;
        if (!eventId) throw new Error("eventId is required");
        apiUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
        method = "PATCH";
        body = JSON.stringify(params?.event);
        break;
      }

      case "deleteEvent": {
        const calendarId = params?.calendarId || "primary";
        const eventId = params?.eventId;
        if (!eventId) throw new Error("eventId is required");
        apiUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
        method = "DELETE";
        break;
      }

      case "checkConnection":
        return new Response(JSON.stringify({ connected: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Make API request
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const apiResponse = await fetch(apiUrl, { method, headers, body });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("Google Calendar API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Google Calendar API error", details: errorText }),
        {
          status: apiResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Handle DELETE which returns no content
    if (method === "DELETE") {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await apiResponse.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Google Calendar API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
