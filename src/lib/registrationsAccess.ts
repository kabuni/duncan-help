// Users (by auth user_id) who are granted access to the Registrations area
// without needing the full admin role. Keep this list short and explicit.
export const REGISTRATIONS_ALLOWED_USER_IDS: ReadonlySet<string> = new Set([
  // Pratik (Operations, Executive)
  "3b8d4435-6d70-4c95-8b0b-272d8c458bbb",
]);

export function canAccessRegistrations(opts: {
  isAdmin: boolean;
  userId: string | null | undefined;
}): boolean {
  if (opts.isAdmin) return true;
  if (!opts.userId) return false;
  return REGISTRATIONS_ALLOWED_USER_IDS.has(opts.userId);
}
