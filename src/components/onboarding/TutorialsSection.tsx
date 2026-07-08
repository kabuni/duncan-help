import { PlayCircle, Check, Clock, CircleDashed } from "lucide-react";
import { format } from "date-fns";
import { useTour } from "@/components/onboarding/tour/TourProvider";
import { TOUR_LIST } from "@/components/onboarding/tour/tours";

export function TutorialsSection() {
  const { start, progress } = useTour();

  return (
    <section className="mb-10">
      <div className="mb-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
          Interactive tutorials
        </p>
        <h2 className="text-lg font-semibold text-foreground">Walk through the modules step-by-step</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Guided, in-product walkthroughs that highlight exactly what to click. Resume or replay any time.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TOUR_LIST.map((t) => {
          const p = progress[t.id];
          const status = p?.status ?? "not_started";
          const pct = p ? Math.min(100, Math.round(((p.step ?? 0) / (p.total || t.steps.length)) * 100)) : 0;

          const StatusIcon =
            status === "completed" ? Check : status === "in_progress" ? Clock : CircleDashed;
          const statusText =
            status === "completed"
              ? p?.completed_at
                ? `Completed ${format(new Date(p.completed_at), "MMM d")}`
                : "Completed"
              : status === "in_progress"
              ? `In progress · ${pct}%`
              : status === "skipped"
              ? "Skipped"
              : "Not started";

          const cta =
            status === "completed" || status === "skipped"
              ? "Replay"
              : status === "in_progress"
              ? "Resume"
              : "Start";

          return (
            <div key={t.id} className="rounded-xl border border-border bg-card p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">{t.eta}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed flex-1">{t.description}</p>

              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <StatusIcon className="h-3 w-3" /> {statusText}
              </div>
              <div className="h-1 w-full bg-border rounded-full overflow-hidden mt-2 mb-3">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>

              <button
                onClick={() =>
                  start(t.id, { restart: status === "completed" || status === "skipped" })
                }
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors self-start"
              >
                <PlayCircle className="h-3.5 w-3.5" /> {cta} tutorial
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
