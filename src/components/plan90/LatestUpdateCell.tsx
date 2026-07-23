import { cn } from "@/lib/utils";
import { MessageSquare, MessageSquarePlus } from "lucide-react";
import type { Plan90Update, Plan90Ryg } from "@/hooks/usePlan90Updates";

const dotClass: Record<Plan90Ryg, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

interface Props {
  latest: Plan90Update | undefined;
  onOpen: () => void;
  count?: number;
}

export function LatestUpdateCell({ latest, onOpen, count }: Props) {
  if (!latest) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
        title="Add the first update"
        aria-label="Add update"
      >
        <MessageSquarePlus className="h-4 w-4" />
      </button>
    );
  }

  const firstName = latest.author_name.split(/\s+/)[0] || latest.author_name;
  const tooltip = `${firstName} · ${new Date(latest.created_at).toLocaleString()}\n\n${latest.message}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
      title={tooltip}
      aria-label={`View updates${count ? ` (${count})` : ""}`}
    >
      <MessageSquare className="h-4 w-4" />
      <span
        className={cn(
          "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card",
          dotClass[latest.ryg],
        )}
      />
    </button>
  );
}
