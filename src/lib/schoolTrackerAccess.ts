// Restrict the School Registrations tracker page to specific users.
export const SCHOOL_TRACKER_ALLOWED_USER_IDS: ReadonlySet<string> = new Set([
  // Palash
  "e8284615-2e27-458b-bec8-714adafd5cb0",
  // Pratik
  "3b8d4435-6d70-4c95-8b0b-272d8c458bbb",
]);

export function canAccessSchoolTracker(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return SCHOOL_TRACKER_ALLOWED_USER_IDS.has(userId);
}
