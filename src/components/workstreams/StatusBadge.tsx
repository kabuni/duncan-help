import type { CardStatus } from "@/hooks/useWorkstreams";

const statusConfig: Record<CardStatus, { label: string; bg: string; text: string; dot: string; border: string }> = {
  not_started: { label: "Not started", bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground/60", border: "border-border" },
  red: { label: "Red", bg: "bg-red-500/10", text: "text-red-500", dot: "bg-red-500", border: "border-red-500/30" },
  amber: { label: "Yellow", bg: "bg-amber-500/10", text: "text-amber-500", dot: "bg-amber-500", border: "border-amber-500/30" },
  green: { label: "Green", bg: "bg-emerald-500/10", text: "text-emerald-500", dot: "bg-emerald-500", border: "border-emerald-500/30" },
  done: { label: "Done", bg: "bg-primary/10", text: "text-primary", dot: "bg-primary", border: "border-primary/30" },
};

export const priorityConfig: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "text-muted-foreground" },
  medium: { label: "Medium", color: "text-amber-500" },
  high: { label: "High", color: "text-orange-500" },
  critical: { label: "Critical", color: "text-red-500" },
};

export function StatusBadge({ status, size = "sm" }: { status: CardStatus; size?: "sm" | "md" }) {
  const c = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${c.bg} ${c.text} ${c.border} font-medium ${size === "md" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10px]"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

export function StatusDot({ status }: { status: CardStatus }) {
  const c = statusConfig[status];
  return <span className={`h-2.5 w-2.5 rounded-full ${c.dot} ring-2 ring-background`} />;
}

export function getStatusBorderClass(status: CardStatus): string {
  const map: Record<CardStatus, string> = {
    not_started: "border-l-muted-foreground/40",
    red: "border-l-red-500",
    amber: "border-l-amber-500",
    green: "border-l-emerald-500",
    done: "border-l-primary",
  };
  return map[status];
}

export { statusConfig };
