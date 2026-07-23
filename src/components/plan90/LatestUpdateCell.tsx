import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { Plan90Update, Plan90Ryg } from "@/hooks/usePlan90Updates";

const dotClass: Record<Plan90Ryg, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

interface Props {
  latest: Plan90Update | undefined;
  onOpen: () => void;
}

export function LatestUpdateCell({ latest, onOpen }: Props) {
  if (!latest) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex items-center gap-2 text-left text-[11px] text-muted-foreground hover:text-primary transition-colors w-full"
        title="Add the first update"
      >
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
        <span className="italic">No updates</span>
        <span className="opacity-0 group-hover:opacity-100 text-[10px] text-primary">Add</span>
      </button>
    );
  }

  const firstName = latest.author_name.split(/\s+/)[0] || latest.author_name;
  const rel = formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })
    .replace("about ", "")
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" days", "d")
    .replace(" day", "d")
    .replace(" months", "mo")
    .replace(" month", "mo");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-start gap-2 text-left w-full min-w-0 hover:bg-secondary/50 rounded-md px-1.5 py-1 -mx-1.5 -my-1 transition-colors"
      title={`${latest.author_name} · ${new Date(latest.created_at).toLocaleString()}\n\n${latest.message}`}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0 mt-1.5",
          dotClass[latest.ryg],
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-foreground truncate leading-snug">{latest.message}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {firstName} · {rel}
        </div>
      </div>
    </button>
  );
}
