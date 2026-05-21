import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import ScoreGauge from "./ScoreGauge";

interface Tldr {
  on_track?: string;
  what_will_break?: string;
  where_to_act?: string;
}

interface VerdictHeroProps {
  trajectory?: string | null;
  outcomeProbability?: number | null;
  probabilityDelta?: number | null;
  executionScore?: number | null;
  executionDelta?: number | null;
  coverageRatio?: number | null;
  coverageCovered?: number | null;
  coverageTotal?: number | null;
  confidenceWarning?: string | null;
  tldr?: Tldr | null;
}

type Verdict = { dot: string; label: string; tone: string };

const computeVerdict = (
  trajectory?: string | null,
  prob?: number | null,
  redWorkstreams = 0,
): Verdict => {
  const t = (trajectory || "").toLowerCase();
  const p = typeof prob === "number" ? prob : 50;
  if (t.includes("off track") || p < 50 || redWorkstreams >= 3) {
    return { dot: "bg-red-500", label: "OFF TRACK", tone: "text-red-500 border-red-500/30 bg-red-500/5" };
  }
  if (t.includes("on track") && p >= 70 && redWorkstreams === 0) {
    return { dot: "bg-green-500", label: "ON TRACK", tone: "text-green-500 border-green-500/30 bg-green-500/5" };
  }
  return { dot: "bg-yellow-500", label: "AT RISK", tone: "text-yellow-500 border-yellow-500/30 bg-yellow-500/5" };
};

const oneSentence = (tldr?: Tldr | null): string => {
  if (!tldr) return "Duncan has no synthesised verdict yet — generate the briefing to populate.";
  // Prefer the most urgent piece
  if (tldr.where_to_act) return tldr.where_to_act;
  if (tldr.what_will_break) return tldr.what_will_break;
  if (tldr.on_track) return tldr.on_track;
  return "—";
};

const VerdictHero = ({
  trajectory,
  outcomeProbability,
  probabilityDelta,
  executionScore,
  executionDelta,
  coverageRatio,
  coverageCovered,
  coverageTotal,
  confidenceWarning,
  tldr,
}: VerdictHeroProps) => {
  const lowEvidence = typeof coverageRatio === "number" && coverageRatio < 0.5;
  const covered = coverageCovered ?? 0;
  const total = coverageTotal ?? 6;
  const verdict = computeVerdict(trajectory, outcomeProbability);
  const sentence = oneSentence(tldr);

  const coverageScore =
    typeof coverageRatio === "number" ? Math.round(coverageRatio * 100) : null;

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
              {confidenceWarning || "Scores are capped until missing workstreams are created."}
            </p>
          </div>
        </div>
      )}

      <div className={cn("rounded-lg border-2 bg-card p-5 sm:p-6 space-y-5", verdict.tone)}>
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <div className="flex items-center gap-3 md:shrink-0">
            <span className={cn("inline-block h-4 w-4 rounded-full shrink-0", verdict.dot)} />
            <Badge
              variant="outline"
              className={cn("text-sm font-semibold font-mono tracking-widest", verdict.tone)}
            >
              {verdict.label}
            </Badge>
          </div>
          <p className="text-base sm:text-lg font-medium text-foreground leading-snug flex-1">
            {sentence}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-4 border-t border-border/60">
          <div className="flex justify-center">
            <ScoreGauge
              label="Probability"
              score={outcomeProbability ?? 0}
              delta={probabilityDelta ?? undefined}
              size="md"
            />
          </div>
          <div className="flex justify-center">
            <ScoreGauge
              label="Execution"
              score={executionScore ?? 0}
              delta={executionDelta ?? undefined}
              size="md"
            />
          </div>
          <div className="flex justify-center">
            <ScoreGauge
              label="Coverage"
              score={coverageScore ?? 0}
              size="md"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerdictHero;
