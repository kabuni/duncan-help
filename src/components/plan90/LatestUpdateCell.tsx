import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Maximize2 } from "lucide-react";
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
  const [expanded, setExpanded] = useState(false);

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
    .replace(" minutes", "m").replace(" minute", "m")
    .replace(" hours", "h").replace(" hour", "h")
    .replace(" days", "d").replace(" day", "d")
    .replace(" months", "mo").replace(" month", "mo");

  const isLong = latest.message.length > 60 || latest.message.includes("\n");

  return (
    <div className="flex items-start gap-2 w-full min-w-0 max-w-[240px]">
      <span
        className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", dotClass[latest.ryg])}
        title={latest.ryg}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-xs text-foreground leading-snug",
            !expanded && "overflow-hidden text-ellipsis whitespace-nowrap",
            expanded && "whitespace-pre-wrap break-words",
          )}
          title={!expanded ? latest.message : undefined}
        >
          {latest.message}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
          <span className="truncate">{firstName} · {rel}</span>
          {isLong && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="inline-flex items-center gap-0.5 hover:text-primary shrink-0"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Less" : "More"}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="inline-flex items-center gap-0.5 hover:text-primary shrink-0 ml-auto"
            title="Open full history"
          >
            <Maximize2 className="h-2.5 w-2.5" />
            History
          </button>
        </div>
      </div>
    </div>
  );
}
