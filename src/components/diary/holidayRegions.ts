// Shared metadata for Public Holiday regions.
// Future-proof: add new regions here without touching approval logic.

export type HolidayRegion =
  | "Global"
  | "UK"
  | "India"
  | "India North"
  | "India South"
  | "Canada";

export const HOLIDAY_REGIONS: HolidayRegion[] = [
  "Global",
  "UK",
  "India",
  "India North",
  "India South",
  "Canada",
];

// Regions a user can belong to (Global is implicit / everyone).
export const USER_REGIONS: HolidayRegion[] = [
  "UK",
  "India",
  "India North",
  "India South",
  "Canada",
];

const FLAGS: Record<string, string> = {
  Global: "🌍",
  UK: "🇬🇧",
  India: "🇮🇳",
  "India North": "🇮🇳",
  "India South": "🇮🇳",
  Canada: "🇨🇦",
};

export function getRegionFlag(region?: string | null): string {
  if (!region) return "🌍";
  return FLAGS[region] || "🌍";
}

export function formatHolidayTitle(name: string, region?: string | null): string {
  const flag = getRegionFlag(region);
  const label = region || "Global";
  return `${flag} ${name} [${label}]`;
}
