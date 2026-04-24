Plan to configure the new Google Analytics OAuth credentials

1. Store the new credentials securely
   - Add these runtime secrets for the backend functions:
     - `GOOGLE_ANALYTICS_CLIENT_ID`
     - `GOOGLE_ANALYTICS_CLIENT_SECRET`
   - These are the exact secret names the existing Google Analytics auth/callback code already checks first.

2. Keep the existing code path intact
   - No code change should be needed if the new secrets are added correctly.
   - Current code already prefers `GOOGLE_ANALYTICS_CLIENT_ID/SECRET` before falling back to Calendar/Gmail credentials.

3. Confirm the required Google redirect URI
   - The Google Cloud OAuth client for the new Analytics credentials must include this exact authorized redirect URI:
     ```text
     https://rfwvemsjwytxxhwowpqh.supabase.co/functions/v1/google-analytics-callback
     ```
   - It must match exactly: same protocol, domain, path, and no trailing slash.

4. Test the flow after secrets are saved
   - Trigger the Google Analytics connect flow from the app.
   - Confirm the generated OAuth URL uses the dedicated Analytics client ID rather than the Calendar/Gmail fallback.
   - Complete the callback and verify the token is saved and the Integrations/Operations UI shows the connected state.

Technical note

The current error is almost certainly caused by the app using fallback OAuth credentials because `GOOGLE_ANALYTICS_CLIENT_ID` and `GOOGLE_ANALYTICS_CLIENT_SECRET` are not currently configured. Once those two secrets are added, the existing `google-analytics-auth` and `google-analytics-callback` functions should use the new dedicated Google Analytics OAuth client automatically.