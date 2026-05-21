import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DoTodayProps {
  decisions?: any[];
}

const confTone = (conf: string) => {
  switch (conf) {
    case "high": return "border-green-500/40 text-green-600 dark:text-green-400";
    case "medium": return "border-yellow-500/40 text-yellow-600 dark:text-yellow-400";
    case "low": return "border-red-500/40 text-red-600 dark:text-red-400";
    default: return "border-border text-muted-foreground";
  }
};

const DoToday = ({ decisions = [] }: DoTodayProps) => {
  const top = decisions.slice(0, 3);

  if (top.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6">
        <h3 className="text-sm font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Do today
        </h3>
        <p className="text-sm text-muted-foreground">
          No CEO-grade decisions detected — trajectory is steady.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          Do today · top {top.length}
        </h3>
        <Link
          to="#decisions"
          className="text-[11px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          See all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {top.map((d: any, i: number) => {
          const conf = (d.confidence || "").toLowerCase();
          return (
            <div
              key={i}
              className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2 flex flex-col"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {conf && (
                  <Badge
                    variant="outline"
                    className={cn("text-[9px] font-mono uppercase whitespace-nowrap", confTone(conf))}
                  >
                    {conf}
                  </Badge>
                )}
              </div>
              <h4 className="text-sm font-semibold text-foreground leading-snug break-words">
                {d.decision}
              </h4>
              {d.why_it_matters && (
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {d.why_it_matters}
                </p>
              )}
              {d.consequence && (
                <p className="text-[11px] text-red-500/90 leading-snug border-t border-border/40 pt-2">
                  If ignored 7d: {d.consequence}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DoToday;
