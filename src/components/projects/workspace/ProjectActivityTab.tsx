import { useProjectActivity, useProjectWorkstreams } from "@/hooks/useProjectWork";
import { EmptyLine, SectionTitle } from "./shared";
import { ProjectProgressRing, useProjectProgress, WorkstreamProgressBar } from "./ProjectProgressRing";

function when(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function ProjectActivityTab({ projectId }: { projectId: string }) {
  const { data: activity = [] } = useProjectActivity(projectId);
  const { data: areas = [] } = useProjectWorkstreams(projectId);
  const { total, done, pct } = useProjectProgress(projectId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-10">
      {/* Project progress — the same underlying tasks as the ring and the area bars */}
      <section className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Project progress</h2>
          <p className="text-sm text-muted-foreground">Calculated from the project's tasks as they are completed.</p>
        </div>

        <div className="flex items-center gap-6 rounded-xl border border-border bg-card px-5 py-5">
          <ProjectProgressRing pct={pct} done={done} total={total} size={84} stroke={6} />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-foreground">
              {done} of {total} task{total === 1 ? "" : "s"} complete
            </p>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Overall project progress: ${pct} percent`}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {areas.length > 0 && (
          <div className="space-y-3">
            <SectionTitle>Progress by area of work</SectionTitle>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {areas.map((a) => (
                <li key={a.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{a.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{a.task_code}</span>
                  </div>
                  <div className="-ml-5">
                    <WorkstreamProgressBar done={a.tasks_done} total={a.tasks_total} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Recent activity</h2>
          <p className="text-sm text-muted-foreground">What has changed on this project recently.</p>
        </div>
        {activity.length === 0 ? (
          <EmptyLine>Nothing has happened here yet.</EmptyLine>
        ) : (
          <ul className="space-y-3.5">
            {activity.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">
                  <span className="text-foreground">{a.actor || "Someone"}</span> {a.text}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{when(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
