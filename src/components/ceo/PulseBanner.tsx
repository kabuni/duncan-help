import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import ScoreGauge from "./ScoreGauge";

interface PulseBannerProps {
  trajectory?: string;
  outcomeProbability?: number;
  probabilityDelta?: number | null;
  executionScore?: number;
  executionDelta?: number | null;
  coverageRatio?: number | null;
  coverageCovered?: number | null;
  coverageTotal?: number | null;
  confidenceWarning?: string | null;
  probabilityMovement?: string | null;
  executionExplanation?: string | null;
}

const trajectoryStyle = (t?: string) => {
  switch ((t || "").toLowerCase()) {
    case "on track": return "bg-green-500/10 text-green-500 border-green-500/30";
    case "slight drift": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
    case "at risk": return "bg-orange-500/10 text-orange-500 border-orange-500/30";
    case "off track": return "bg-red-500/10 text-red-500 border-red-500/30";
    default: return "bg-muted text-muted-foreground";
  }
};

const PulseBanner = ({
  trajectory,
  outcomeProbability = 0,
  probabilityDelta,
  executionScore = 0,
  executionDelta,
  coverageRatio,
  coverageCovered,
  coverageTotal,
  confidenceWarning,
  probabilityMovement,
  executionExplanation,
}: PulseBannerProps) => {
  const lowEvidence = typeof coverageRatio === "number" && coverageRatio < 0.5;
  const covered = coverageCovered ?? 0;
  const total = coverageTotal ?? 6;
  const hasCaptions = !!(probabilityMovement || executionExplanation);

  return (
    <div className="space-y-3">
      {lowEvidence && (
        <div className="flex items-start gap-2 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-foreground">
              Low-evidence briefing — Duncan can only see {covered} of {total} 2026 priorities.
            </p>
            <p className="text-[11px] text-muted-foreground">
              {confidenceWarning || "Probability and execution scores are capped until missing workstreams are created."}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-col 2xl:flex-row items-stretch gap-4 sm:gap-6 rounded-lg border border-border bg-card p-4 sm:p-6 min-w-0">
        <div className="flex flex-col justify-center gap-3 min-w-0 2xl:basis-64 2xl:shrink-0">
          <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">June 7 Trajectory</span>
          <Badge variant="outline" className={cn("w-fit max-w-full text-sm sm:text-base px-3 sm:px-4 py-1.5 font-semibold whitespace-nowrap", trajectoryStyle(trajectory))}>
            {trajectory || "—"}
          </Badge>
          <p className="text-sm text-muted-foreground break-words">India Lightning Strike readiness only — overall company health shown in Company Pulse above.</p>
        </div>
        <div className={cn(
          "flex flex-col gap-4 2xl:flex-1 2xl:border-l 2xl:border-border 2xl:pl-6 pt-4 border-t border-border 2xl:pt-0 2xl:border-t-0 transition-opacity min-w-0",
          lowEvidence && "opacity-60"
        )}>
          <div className="flex items-center justify-around gap-4 sm:gap-6">
            <ScoreGauge label="Probability %" score={outcomeProbability} delta={probabilityDelta} size="lg" />
            <ScoreGauge label="Execution" score={executionScore} delta={executionDelta} size="lg" />
          </div>
          {hasCaptions && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-3 border-t border-border">
              <p className="text-[11px] text-muted-foreground leading-snug break-words">
                <span className="font-mono uppercase tracking-wider text-foreground/70">Probability:</span>{" "}
                {probabilityMovement || "No movement context."}
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug break-words">
                <span className="font-mono uppercase tracking-wider text-foreground/70">Execution:</span>{" "}
                {executionExplanation || "—"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PulseBanner;
