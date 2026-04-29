import type { CardStatus } from "@/hooks/useWorkstreams";

interface TaskBreakdown {
  red: number;
  yellow: number;
  green: number;
  done: number;
}

const healthConfig: Record<CardStatus, { emoji: string; label: string; text: string; bg: string; border: string }> = {
  red:   { emoji: "🔴", label: "At Risk",          text: "text-red-500",     bg: "bg-red-500/10",     border: "border-red-500/30" },
  amber: { emoji: "🟡", label: "Needs Attention",  text: "text-amber-500",   bg: "bg-amber-500/10",   border: "border-amber-500/30" },
  green: { emoji: "🟢", label: "On Track",         text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  done:  { emoji: "✅", label: "Complete",         text: "text-primary",     bg: "bg-primary/10",     border: "border-primary/30" },
};

export function getHealthLabel(status: CardStatus) {
  return healthConfig[status];
}

interface HealthBadgeProps {
  status: CardStatus;
  size?: "sm" | "md";
  prefix?: string;
}

export function HealthBadge({ status, size = "sm", prefix = "Health" }: HealthBadgeProps) {
  const c = healthConfig[status];
  const sizeCls = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${c.bg} ${c.text} ${c.border} ${sizeCls}`}
      title={`${prefix}: ${c.label}`}
    >
      <span aria-hidden>{c.emoji}</span>
      <span>{prefix ? `${prefix}: ` : ""}{c.label}</span>
    </span>
  );
}

interface BreakdownProps {
  breakdown: TaskBreakdown;
  className?: string;
}

export function TaskBreakdownPills({ breakdown, className = "" }: BreakdownProps) {
  const items: Array<{ key: keyof TaskBreakdown; letter: string; color: string }> = [
    { key: "red",    letter: "R", color: "text-red-500" },
    { key: "yellow", letter: "Y", color: "text-amber-500" },
    { key: "green",  letter: "G", color: "text-emerald-500" },
    { key: "done",   letter: "D", color: "text-primary" },
  ];
  const total = breakdown.red + breakdown.yellow + breakdown.green + breakdown.done;
  if (total === 0) {
    return <span className={`text-[10px] text-muted-foreground/60 ${className}`}>No tasks</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${className}`}>
      {items.map((it, i) => {
        const v = breakdown[it.key];
        const muted = v === 0;
        return (
          <span key={it.key} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${
              it.key === "red" ? "bg-red-500"
              : it.key === "yellow" ? "bg-amber-500"
              : it.key === "green" ? "bg-emerald-500"
              : "bg-primary"
            } ${muted ? "opacity-30" : ""}`} />
            <span className={`${muted ? "text-muted-foreground/40" : it.color}`}>{v}{it.letter}</span>
            {i < items.length - 1 && <span className="text-muted-foreground/30">•</span>}
          </span>
        );
      })}
    </span>
  );
}

export function StatusMismatchWarning({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 ${className}`}
      title="The manual card status doesn't match the computed task health"
    >
      ⚠️ <span>Status mismatch</span>
    </span>
  );
}
