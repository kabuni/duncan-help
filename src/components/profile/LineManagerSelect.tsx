import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTeamDirectory } from "@/hooks/useTeamDirectory";

interface LineManagerSelectProps {
  /** Currently selected manager's profile id. */
  value: string | null;
  onChange: (profileId: string | null) => void;
  /** Profile id to exclude (nobody can report to themselves). */
  excludeProfileId?: string | null;
  allowNone?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Picks a line manager from the existing Duncan team directory. Never free text,
 * never a hardcoded person.
 */
export default function LineManagerSelect({
  value,
  onChange,
  excludeProfileId,
  allowNone = false,
  disabled,
  placeholder = "Select your line manager",
}: LineManagerSelectProps) {
  const { data: members = [], isLoading } = useTeamDirectory();

  const options = useMemo(
    () => members.filter((m) => m.id !== excludeProfileId),
    [members, excludeProfileId],
  );

  return (
    <Select
      value={value ?? (allowNone ? "__none" : undefined)}
      onValueChange={(v) => onChange(v === "__none" ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className="h-9">
        <SelectValue placeholder={isLoading ? "Loading team…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="__none">Not set</SelectItem>}
        {options.length === 0 && !isLoading ? (
          <SelectItem value="__empty" disabled>No team members available</SelectItem>
        ) : (
          options.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.display_name}
              {m.role_title ? ` — ${m.role_title}` : ""}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
