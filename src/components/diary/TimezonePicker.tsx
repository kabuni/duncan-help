import { useMemo } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PINNED_TIMEZONES: { value: string; label: string }[] = [
  { value: "Europe/London", label: "United Kingdom (London)" },
  { value: "Asia/Kolkata", label: "India (Kolkata)" },
];

/** Build the full IANA list at runtime; fall back to a curated list if unavailable. */
function getAllZones(): string[] {
  try {
    // @ts-ignore — supportedValuesOf is available in modern runtimes
    const list: string[] = (Intl as any).supportedValuesOf?.("timeZone") ?? [];
    if (list.length) return list;
  } catch {}
  return [
    "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Amsterdam",
    "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "Australia/Sydney", "Pacific/Auckland", "UTC",
  ];
}

interface Props {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
  id?: string;
}

export function TimezonePicker({ value, onChange, className, id }: Props) {
  const allZones = useMemo(() => {
    const pinned = new Set(PINNED_TIMEZONES.map((z) => z.value));
    return getAllZones().filter((z) => !pinned.has(z)).sort();
  }, []);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder="Select time zone" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectGroup>
          <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Pinned</SelectLabel>
          {PINNED_TIMEZONES.map((tz) => (
            <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">All time zones</SelectLabel>
          {allZones.map((tz) => (
            <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** Format an ISO timestamp in the given IANA timezone. */
export function formatInTz(iso: string | null | undefined, tz: string, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      ...opts,
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Time-only in tz, e.g. "14:00 BST". */
export function formatTimeInTz(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  } catch {
    return "";
  }
}

/** Convert a local date+time entered AS the chosen timezone into a UTC ISO string. */
export function zonedDateTimeToISO(dateStr: string, timeStr: string, tz: string): string {
  // Build the "wall clock" target date, then offset by the difference between
  // that wall clock interpreted as UTC and as the target tz.
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  const utcGuess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  // The tz offset = (wall clock seen in tz) - (wall clock seen in UTC) for the same instant.
  // To convert a wall-clock time meant to be IN `tz` into the correct UTC instant,
  // we subtract that offset from our utcGuess (which assumed the wall clock was UTC).
  const asTz = new Date(new Date(utcGuess).toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(new Date(utcGuess).toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = asTz.getTime() - asUtc.getTime();
  return new Date(utcGuess - offset).toISOString();
}
