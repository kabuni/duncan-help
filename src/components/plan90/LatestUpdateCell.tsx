import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { Plan90Update, Plan90Ryg } from "@/hooks/usePlan90Updates";

const dotClass: Record<Plan90Ryg, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export function LatestUpdateCell({ latest }: { latest: Plan90Update | undefined }) {
  if (!latest) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground min-w-0">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
        <span className="italic truncate">No updates</span>
      </div>
    );
  }

  const firstName = latest.author_name.split(/\s+/)[0] || latest.author_name;
  const rel = formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })
    .replace("about ", "")
    .replace(" minutes", "m").replace(" minute", "m")
    .replace(" hours", "h").replace(" hour", "h")
    .replace(" days", "d").replace(" day", "d")
    .replace(" months", "mo").replace(" month", "mo");

  return (
    <div
      className="flex items-center gap-2 min-w-0 max-w-full"
      title={`${latest.author_name} · ${new Date(latest.created_at).toLocaleString()}\n\n${latest.message}`}
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass[latest.ryg])} />
      <span className="text-xs text-foreground truncate min-w-0">{latest.message}</span>
      <span className="text-[10px] text-muted-foreground shrink-0 hidden md:inline">
        {firstName} · {rel}
      </span>
    </div>
  );
}
