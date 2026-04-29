## Plan: Remove HubSpot and GitHub cards from Integrations page

### Change
Add `"hubspot"` and `"github"` to the existing `hiddenIntegrationIds` set in `src/pages/Integrations.tsx` (line 226). This is the same mechanism already used to hide Azure Blob, Basecamp, and Azure DevOps cards.

**Before:**
```ts
const hiddenIntegrationIds = new Set(["azure-blob", "basecamp", "azure-devops"]);
```

**After:**
```ts
const hiddenIntegrationIds = new Set(["azure-blob", "basecamp", "azure-devops", "hubspot", "github"]);
```

### Scope (what this does NOT touch)
- Integration definitions (lines 194–223) stay in place — useful if we ever want to re-enable.
- Edge functions `hubspot-api`, `github-api`, `manage-company-integration` remain deployed and functional.
- Any existing `company_integrations` rows for hubspot/github are untouched.
- Backend logic that consumes HubSpot/GitHub (e.g. CEO briefing references) is unaffected.

### Result
The two cards stop rendering on the Integrations page. Pure UI hide — fully reversible by removing the two IDs from the set.

Awaiting approval.