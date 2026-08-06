// Users (by auth user_id) who are granted access to the Registrations area
// without needing the full admin role. Keep this list short and explicit.
export const REGISTRATIONS_ALLOWED_USER_IDS: ReadonlySet<string> = new Set([
  // Pratik (Operations, Executive)
  "3b8d4435-6d70-4c95-8b0b-272d8c458bbb",
  // Adit Bhargava
  "8f8607b0-9074-41c9-a9fb-43d48639feba",
]);

// Viewing is now open to every signed-in user; the allowlist above is kept for
// reference only.
export function canAccessRegistrations(opts: {
  isAdmin: boolean;
  userId: string | null | undefined;
}): boolean {
  return opts.isAdmin || !!opts.userId;
}
