import { Progress } from "@/components/ui/progress";
import { RagBadge } from "./HealthPrimitives";
import { usePeopleCulture } from "@/hooks/usePeopleCulture";

/**
 * People & Culture — live employee survey metrics.
 * SOURCE: employee survey Google Sheet, read by the `people-culture-metrics` edge function.
 */
export default function PeopleCulture() {
  const { data, isLoading, error, rag } = usePeopleCulture();

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading employee survey…</p>;
  }

  if (error) {
    return (
      <p className="text-xs text-destructive">
        Employee survey unavailable: {(error as Error).message}. Make sure the survey sheet is
        shared with duncan@kabuni.com (Viewer).
      </p>
    );
  }

  if (!data || !data.responses) {
    return <p className="text-xs text-muted-foreground">No survey responses yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">{data.responses}</p>
          <p className="text-[11px] text-muted-foreground">Responses captured</p>
        </div>
        {data.enps !== null && (
          <div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{data.enps}</p>
            <p className="text-[11px] text-muted-foreground">eNPS</p>
          </div>
        )}
        {data.lastResponse && (
          <div>
            <p className="text-sm font-semibold text-foreground">
              {new Date(data.lastResponse).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
            <p className="text-[11px] text-muted-foreground">Latest response</p>
          </div>
        )}
        <div className="ml-auto">
          <RagBadge rag={rag} size="md" />
        </div>
      </div>

      <div className="space-y-3 pt-1 border-t border-border">
        {data.metrics.map((m) => (
          <div key={m.question} className="space-y-1 pt-3 first:pt-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground min-w-0 break-words">{m.question}</p>
              <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                {m.average.toFixed(1)}
                <span className="text-muted-foreground font-normal"> / {m.scaleMax}</span>
              </p>
            </div>
            <Progress value={m.normalised} aria-label={`${m.question}: ${m.normalised}%`} />
          </div>
        ))}
        {!data.metrics.length && (
          <p className="pt-3 text-xs text-muted-foreground">
            No rating-scale questions detected in the survey sheet.
          </p>
        )}
      </div>
    </div>
  );
}
