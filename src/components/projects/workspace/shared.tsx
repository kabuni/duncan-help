import { RYG_META } from "@/hooks/useProjectWork";

export function initials(name: string | null | undefined) {
  return (
    (name || "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function formatDay(date: string | null | undefined) {
  if (!date) return null;
  const d = new Date(date + (date.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function relativeDay(date: string | null | undefined) {
  if (!date) return null;
  const d = new Date(date + (date.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 0) return `Overdue · ${formatDay(date)}`;
  return `Due ${formatDay(date)}`;
}

export function StatusDot({ status, className = "" }: { status: string; className?: string }) {
  const meta = RYG_META[status] || RYG_META.not_started;
  return <span className={`inline-block h-2 w-2 rounded-full ${meta.dot} ${className}`} aria-label={meta.label} />;
}

export function Avatars({ names }: { names: (string | null)[] }) {
  return (
    <div className="flex -space-x-2">
      {names.slice(0, 5).map((n, i) => (
        <span
          key={i}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-background bg-secondary text-[10px] font-medium text-secondary-foreground"
          title={n || undefined}
        >
          {initials(n)}
        </span>
      ))}
      {names.length > 5 && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-background bg-muted text-[10px] text-muted-foreground">
          +{names.length - 5}
        </span>
      )}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</h2>;
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
