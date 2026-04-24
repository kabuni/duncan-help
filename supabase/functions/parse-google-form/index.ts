import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface FormField {
  entry_id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { formUrl } = await req.json();

    if (!formUrl) {
      return new Response(
        JSON.stringify({ error: "formUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize to viewform URL
    let viewUrl = formUrl.trim();
    if (!viewUrl.includes("/viewform")) {
      viewUrl = viewUrl.replace(/\/?$/, "/viewform");
    }

    console.log("Fetching form:", viewUrl);

    const resp = await fetch(viewUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch form: HTTP ${resp.status}`);
    }

    const html = await resp.text();

    // Extract form title
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                       html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(" - Google Forms", "").trim() : "Untitled Form";

    // Extract form description
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    const description = descMatch ? descMatch[1].trim() : null;

    // Extract the form action URL
    const formIdMatch = viewUrl.match(/\/d\/e\/([^/]+)\//);
    const formActionUrl = formIdMatch
      ? `https://docs.google.com/forms/d/e/${formIdMatch[1]}/formResponse`
      : null;

    // Google Forms stores its data in a FB_PUBLIC_LOAD_DATA_ script
    const fbDataMatch = html.match(/var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
    
    const fields: FormField[] = [];

    if (fbDataMatch) {
      try {
        const fbData = JSON.parse(fbDataMatch[1]);
        // fbData[1][1] contains the form field groups
        const fieldGroups = fbData?.[1]?.[1];
        if (Array.isArray(fieldGroups)) {
          for (const group of fieldGroups) {
            // group[1] = question label
            // group[4] = array of field entries
            const label = group?.[1] || "";
            const entries = group?.[4];
            if (!Array.isArray(entries)) continue;

            for (const entry of entries) {
              const entryId = entry?.[0];
              const fieldType = entry?.[3]; // numeric type
              const isRequired = entry?.[4] === 1;
              const optionsList = entry?.[1];

              if (entryId == null) continue;

              // Map Google Forms field types
              let type = "text";
              switch (fieldType) {
                case 0: type = "short_text"; break;
                case 1: type = "paragraph"; break;
                case 2: type = "radio"; break;
                case 3: type = "dropdown"; break;
                case 4: type = "checkbox"; break;
                case 5: type = "scale"; break;
                case 7: type = "grid"; break;
                case 9: type = "date"; break;
                case 10: type = "time"; break;
                case 13: type = "file_upload"; break;
              }

              const options: string[] = [];
              if (Array.isArray(optionsList)) {
                for (const opt of optionsList) {
                  if (opt?.[0]) options.push(opt[0]);
                }
              }

              fields.push({
                entry_id: `entry.${entryId}`,
                label,
                type,
                required: isRequired,
                ...(options.length > 0 ? { options } : {}),
              });
            }
          }
        }
      } catch (parseErr) {
        console.error("Failed to parse FB_PUBLIC_LOAD_DATA_:", parseErr);
      }
    }

    // Fallback: parse HTML input elements if FB_PUBLIC_LOAD_DATA_ parsing failed
    if (fields.length === 0) {
      console.log("Falling back to HTML parsing");
      const entryRegex = /name="(entry\.\d+)"[^>]*/gi;
      let match;
      const seenEntries = new Set<string>();
      while ((match = entryRegex.exec(html)) !== null) {
        const entryId = match[1];
        if (seenEntries.has(entryId)) continue;
        seenEntries.add(entryId);

        // Try to find the label for this entry
        const labelPattern = new RegExp(
          `data-params="[^"]*${entryId.replace("entry.", "")}[^"]*"[\\s\\S]*?<span[^>]*>([^<]+)</span>`,
          "i"
        );
        const labelMatch = html.match(labelPattern);

        fields.push({
          entry_id: entryId,
          label: labelMatch ? labelMatch[1].trim() : entryId,
          type: "text",
          required: false,
        });
      }
    }

    console.log(`Parsed ${fields.length} fields from form "${title}"`);

    return new Response(
      JSON.stringify({
        title,
        description,
        form_url: viewUrl,
        form_action_url: formActionUrl,
        fields,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("parse-google-form error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
