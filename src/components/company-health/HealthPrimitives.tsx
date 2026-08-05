import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Rag, Trend } from "@/hooks/useMarketingHealth";

export type { Rag, Trend };

export const ragConfig: Record<Rag, { label: string; bg: string; text: string; dot: string; border: string }> = {
  on_track: { label: "On track", bg: "bg-emerald-500/10", text: "text-emerald-500", dot: "bg-emerald-500", border: "border-emerald-500/30" },
  attention: { label: "Attention", bg: "bg-amber-500/10", text: "text-amber-500", dot: "bg-amber-500", border: "border-amber-500/30" },
  critical: { label: "Critical", bg: "bg-red-500/10", text: "text-red-500", dot: "bg-red-500", border: "border-red-500/30" },
};

export function RagBadge({ rag, size = "sm" }: { rag: Rag; size?: "sm" | "md" }) {
  const c = ragConfig[rag];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        c.bg, c.text, c.border,
        size === "md" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10px]"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden="true" />
      {c.label}
    </span>
  );
}

const trendMeta: Record<Trend, { Icon: typeof ArrowUpRight; label: string; className: string }> = {
  up: { Icon: ArrowUpRight, label: "Trending up", className: "text-emerald-500" },
  down: { Icon: ArrowDownRight, label: "Trending down", className: "text-red-500" },
  flat: { Icon: ArrowRight, label: "Flat", className: "text-muted-foreground" },
};

export function TrendIcon({ trend, delta }: { trend?: Trend; delta?: number | null }) {
  if (!trend) return null;
  const { Icon, label, className } = trendMeta[trend];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide", className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {typeof delta === "number" && (
        <span className="tabular-nums">{delta > 0 ? "+" : ""}{delta.toFixed(1)}%</span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
