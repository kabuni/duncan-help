## Goal
Lock down `norman-chat` so only authenticated users can call it. Two changes, single deployment.

---

## Change 1 — `supabase/config.toml` (lines 3–4)

Flip JWT verification on:
```toml
[functions.norman-chat]
verify_jwt = true
```
All other function entries unchanged.

---

## Change 2 — `supabase/functions/norman-chat/index.ts` (lines 3801–3824)

Replace the permissive auth block with a strict gate that returns **401** for:
- Missing or non-`Bearer` Authorization header
- Anon-key-only callers (`getUser()` returns no user when only the publishable key is sent)

```ts
// Get user from auth header — REQUIRE a real authenticated user.
// Reject missing header or anon-key-only callers (getUser() returns no user for the anon key).
const authHeader = req.headers.get("Authorization");
if (!authHeader || !authHeader.startsWith("Bearer ")) {
  return new Response(
    JSON.stringify({ error: "Unauthorized: missing bearer token" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

let userId: string | null = null;
let userEmail: string = "";
let calendarAccessToken: string | null = null;
let azureStorageAvailable = false;
let notionToken: string | null = null;
let basecampConnected = false;
let slackConnection: { accessToken: string; teamName: string | null; scope: string | null } | null = null;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
  global: { headers: { Authorization: authHeader } },
});
const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
if (userError || !user) {
  return new Response(
    JSON.stringify({ error: "Unauthorized: authenticated user required" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
userId = user.id;
userEmail = user.email || "";
calendarAccessToken = await getCalendarAccessToken(userId, supabaseAdmin);
slackConnection = await getSlackConnection(userId, supabaseAdmin);
```

The rest of the handler is untouched — `userId` is still typed `string | null` so downstream code that already null-checks it keeps working, but in practice it will now always be a real UUID past this point.

---

## Deploy
Redeploy `norman-chat` (`supabase--deploy_edge_functions(["norman-chat"])`).

---

## Behavior after deploy
- Logged-in users: unchanged.
- Anonymous browser callers (anon key fallback in `useNormanChat.ts`): receive **401**, chat will show the error toast. This is the intended security outcome — sign-in is enforced by `ProtectedRoute` on the app routes, so legitimate users always have a session before reaching the chat.
- External callers without a valid user JWT: blocked at the platform gateway (`verify_jwt = true`) AND inside the function.

No memory updates required (Core memory says "Edge Functions use `verify_jwt = false` + `getUser()`"; norman-chat is intentionally an exception going forward — I will note this in the relevant memory file only if you want).