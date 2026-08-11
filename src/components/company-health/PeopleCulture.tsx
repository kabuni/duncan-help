import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { RagBadge } from "./HealthPrimitives";
import { usePeopleCulture, SAMPLE_PEOPLE_CULTURE } from "@/hooks/usePeopleCulture";

/**
 * People & Culture — derived culture indices from the employee survey.
 * SOURCE: employee survey Google Sheet, read + themed by the `people-culture-metrics` edge function.
 * Individual survey questions are rolled up into stable themes so leadership reads indices,
 * not raw question wording.
 */
function scoreTone(score: number) {
  if (score >= 75) return "[&>*]:bg-emerald-500";
  if (score >= 65) return "[&>*]:bg-amber-500";
  return "[&>*]:bg-destructive";
}

export default function PeopleCulture() {
  const { data: liveData, isLoading, error, rag: liveRag } = usePeopleCulture();

  const isSample = !!error || !liveData || !liveData.responses || !liveData.themes.length;
  const data = isSample ? SAMPLE_PEOPLE_CULTURE : liveData;
  const rag = isSample ? ("attention" as const) : liveRag;

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading employee satisfaction…</p>;
  }

  return (
    <div className="space-y-4">
      {isSample && (
        <p className="text-[11px] text-muted-foreground italic">
          Illustrative model — awaiting the first responses. Indices switch to live data
          automatically once responses land.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {data.overall !== null ? Math.round(data.overall) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">Culture index (0–100)</p>
        </div>
        {data.enps !== null && (
          <div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{data.enps}</p>
            <p className="text-[11px] text-muted-foreground">eNPS</p>
          </div>
        )}
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">{data.responses}</p>
          <p className="text-[11px] text-muted-foreground">Responses captured</p>
        </div>
        {data.lastResponse && (
          <div>
            <p className="text-sm font-semibold text-foreground">
              {new Date(data.lastResponse).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
            <p className="text-[11px] text-muted-foreground">Latest response</p>
          </div>
        )}
        <div className="ml-auto">
          <RagBadge rag={rag} size="md" />
        </div>
      </div>

      {(data.strength || data.risk) && (
        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          {data.strength && (
            <div className="rounded-md border border-border p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Strength</p>
              <p className="text-sm font-semibold text-foreground">{data.strength.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {data.strength.description} · {Math.round(data.strength.score)}/100
              </p>
            </div>
          )}
          {data.risk && (
            <div className="rounded-md border border-border p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Watch area</p>
              <p className="text-sm font-semibold text-foreground">{data.risk.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {data.risk.description} · {Math.round(data.risk.score)}/100
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 pt-1 border-t border-border">
        {data.themes.map((t) => (
          <div key={t.key} className="space-y-1 pt-3 first:pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{t.label}</p>
                <p className="text-[11px] text-muted-foreground break-words">
                  {t.description} · {t.questions} question{t.questions === 1 ? "" : "s"}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                {Math.round(t.score)}
                <span className="text-muted-foreground font-normal"> / 100</span>
              </p>
            </div>
            <Progress
              value={t.score}
              className={scoreTone(t.score)}
              aria-label={`${t.label}: ${Math.round(t.score)} out of 100`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
