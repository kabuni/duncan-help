# HubSpot Social Feed on Dashboard

Add a new Dashboard card that pulls connected social channels and recent posts from HubSpot's Social tools API. No engagement metrics (HubSpot's public API doesn't expose follower counts, likes, comments, or shares — those live only in HubSpot's UI).

## What the card shows

- **Connected channels**: Instagram, LinkedIn, Facebook (name + platform icon)
- **Recent posts published via HubSpot** (last 10, newest first):
  - Channel + platform
  - Publish date
  - Post body excerpt (first ~140 chars)
  - Link to the live post on the native platform (when HubSpot returns one)
- Empty state if no channels connected or no posts published via HubSpot
- "Note: metrics not available via HubSpot API" footnote so expectations are clear

## Technical details

### Backend
Extend `supabase/functions/hubspot-api/index.ts` with a new action `social_feed`:
- `GET /broadcast/v1/channels/setting/publish/current` → connected channels (name, type, channelKey)
- `GET /broadcast/v1/broadcasts?limit=10&order=createdAt&direction=desc` → recent broadcasts
- Map `channelGuid` → channel name/platform; normalize platform from channel `type` (1=Twitter, 2=LinkedIn, 3=Facebook, 4=LinkedIn Co, 6=Instagram — confirm via response)
- Return `{ channels: [...], posts: [{ id, channel, platform, publishedAt, body, url }] }`
- Reuse existing HubSpot auth path already in this file

### Frontend
1. New hook `useHubSpotSocialFeed` in `src/hooks/useHomeDashboard.ts` — `supabase.functions.invoke("hubspot-api", { body: { action: "social_feed" } })`, 5-min staleTime.
2. New tile `HubSpotSocialFeedTile` in `src/components/home/HomeDashboard.tsx`:
   - Uses `TileShell` / `TileHeader` for visual consistency
   - Header: `Share2` icon, label "HubSpot · Social"
   - Channels row (small pills with platform icon + name)
   - Posts list (max 10, scrollable, compact rows with date + excerpt + external link)
   - Loading skeleton + empty state
3. Place tile next to existing Social (Google Sheet) tile so the two are clearly distinct sources.

### Out of scope
- Follower counts, likes, comments, shares, engagement rate (not in HubSpot public API)
- Posts published outside HubSpot
- Editing / scheduling posts
