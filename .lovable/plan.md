# Fix sign-in and password reset failures

## What happened

The sign-in and "Forgot password" requests failed with gateway timeouts (504) from the hosted login service while it was waking up — not wrong credentials. The backend now responds normally, so a fresh attempt should work.

There is a second, real problem this exposed: each of those timed-out attempts was counted as a *failed password attempt*. After 5, the sign-in button locks for 15 minutes. So a temporary outage can lock a legitimate user out of their own account, and the lock survives page reloads.

## What to change

1. **Don't punish connection failures.** Only count a genuine credential rejection toward the 5-attempt lockout. Timeouts, offline errors, and other service-side failures (the retryable/network category, including 504s) no longer increment the counter and never trigger the lock.
2. **Clearer message.** When the service can't be reached, show "The sign-in service is temporarily unavailable. Please try again in a moment." instead of a raw error, and the same treatment for the reset-link dialog.
3. **Retry harder on transient failures.** Increase the existing automatic retry from 1 to 2 attempts with a short delay between them, covering both sign-in and reset-link requests, so a brief wake-up hiccup resolves itself.
4. **Escape hatch for anyone already locked.** If the stored lockout came from connection errors it simply won't exist any more; additionally the stored counter resets whenever a request fails for connection reasons, so the current lock clears on the next attempt.

## Technical detail

All changes are in `src/pages/Auth.tsx`:
- Add a `isConnectionError(error)` helper that matches `AuthRetryableFetchError`, `status >= 500`, `status === 0`, and "failed to fetch" messages.
- In `handleSubmit`'s catch block, branch on that helper: connection errors clear `auth_failed_attempts` / `auth_lockout_until` in `localStorage` and show the service-unavailable toast; only non-connection errors increment `failedAttempts` and can set the lockout.
- Extend `withRetry` to use the same helper (currently only string-matches "failed to fetch") and default `retries = 2` with a ~600ms backoff.
- Update `getAuthErrorMessage` to return the friendly unavailable copy for the connection-error category.

No backend or schema changes needed.
