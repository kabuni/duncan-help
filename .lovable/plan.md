## Goal

The HubSpot Social Feed tile shows platform as "Other" for all 3 connected channels (Kabuni, kabuniplay, Kabuni). The current mapping assumes a numeric `channelType`/`type` field, but HubSpot is clearly returning something else. We need to (1) log what HubSpot actually returns, then (2) update the mapping to use the real field/values.

## Step 1 — Log raw channel payload

In `supabase/functions/hubspot-api/index.ts`, inside the `social_feed` action (around line 1166), add a `logHubspot("social channels raw", ...)` call that dumps the entire `channelsRaw` array (full object per channel, not just type) so we can see every available field HubSpot returns — `channelKey`, `channelType`, `accountType`, `type`, `name`, etc. Also log one sample broadcast object for the same reason.

Deploy the function, call `social_feed` via curl (preview user session), then read edge function logs to capture the real shape.

## Step 2 — Update platform mapping based on real values

Based on what the logs show, replace the numeric `PLATFORM` map with a resolver that handles the actual field. Likely candidates HubSpot uses on this endpoint:

- `channelKey` string like `"FACEBOOK"`, `"INSTAGRAM_BUSINESS"`, `"LINKEDIN_COMPANY"`, `"LINKEDIN_USER"`, `"TWITTER"`
- or `accountType` / `type` string

Implementation: build a string-based resolver that normalizes the value (uppercase, substring match) and maps to `"Instagram" | "LinkedIn" | "Facebook" | "Twitter"`. Keep the numeric fallback for safety. Apply the same resolver to both channels and posts.

## Step 3 — Verify

- Re-call `social_feed`; confirm `channels[].platform` is correct for Kabuni / kabuniplay / Kabuni.
- Confirm the tile in the dashboard now shows the correct platform names.

## Out of scope

No UI changes — frontend already renders whatever `platform` string the API returns. No new metrics.

## Files touched

- `supabase/functions/hubspot-api/index.ts` (logging + mapping fix only)
