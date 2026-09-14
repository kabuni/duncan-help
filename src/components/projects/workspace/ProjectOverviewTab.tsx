import { useProjectWorkstreams, useProjectTasks, useProjectActivity, RYG_META, PROJECT_STATUS_META, type ProjectWorkstream } from "@/hooks/useProjectWork";
import { ProjectProgressRing, useProjectProgress } from "./ProjectProgressRing";
import type { ProjectMember } from "@/hooks/useProjects";
import { type AreaOfWorkTarget } from "./AreaOfWorkDrawer";
import { AskDuncanBar } from "./AskDuncanBar";
import { StatusDot, Avatars, SectionTitle, EmptyLine, relativeDay, formatDay } from "./shared";

export function ProjectOverviewTab({
  projectId, projectName, description, members, status, targetDate, onOpenTab, onOpenArea,
}: {
  projectId: string; projectName: string; description: string | null;
  members: ProjectMember[]; status?: string; targetDate?: string | null;
  onOpenTab: (tab: string) => void;
  onOpenArea: (target: AreaOfWorkTarget) => void;
}) {
  const { data: workstreams = [] } = useProjectWorkstreams(projectId);
  const { data: tasks = [] } = useProjectTasks(projectId);
  const { data: activity = [] } = useProjectActivity(projectId);
  const { total, done, pct } = useProjectProgress(projectId);

  const upcoming = tasks.filter((t) => !t.completed).slice(0, 5);
  const owner = members.find((m) => m.isOwner)?.display_name;
  const statusLabel = status ? (PROJECT_STATUS_META[status] || PROJECT_STATUS_META.on_track).label : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-10">
      {/* Progress summary */}
      <section className="flex items-center gap-6">
        <ProjectProgressRing pct={pct} done={done} total={total} />
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold text-foreground truncate">{projectName}</h2>
          <p className="text-sm text-muted-foreground">
            {total === 0 ? "No tasks yet" : `${done} of ${total} tasks complete`}
          </p>
          <p className="text-xs text-muted-foreground">
            {[statusLabel, owner, targetDate ? `Due ${formatDay(targetDate)}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
      </section>

      {description && <p className="text-[15px] leading-7 text-foreground">{description}</p>}

      <AskDuncanBar projectId={projectId} projectName={projectName} members={members} workstreams={workstreams} />

      <section className="space-y-3">
        <SectionTitle>Team</SectionTitle>
        <div className="flex items-center gap-3">
          <Avatars names={members.map((m) => m.display_name)} />
          <button onClick={() => onOpenTab("team")} className="text-sm text-muted-foreground hover:text-foreground">
            {members.length} {members.length === 1 ? "person" : "people"}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Upcoming tasks</SectionTitle>
        {upcoming.length === 0 ? (
          <EmptyLine>Nothing outstanding.</EmptyLine>
        ) : (
          <ul className="space-y-2.5">
            {upcoming.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="text-foreground">{t.title}</span>
                <span className="text-xs text-muted-foreground">{t.assignee_name || "Unassigned"}</span>
                {t.due_date && <span className="text-xs text-muted-foreground">{relativeDay(t.due_date)}</span>}
                {t.workstream_code && (
                  <span className="text-xs text-muted-foreground">{t.workstream_title} · <span className="font-mono">{t.workstream_code}</span></span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Areas of work</SectionTitle>
        {workstreams.length === 0 ? (
          <EmptyLine>No areas of work connected yet.</EmptyLine>
        ) : (
          <ul className="space-y-2.5">
            {workstreams.map((ws) => (
              <li key={ws.id}>
                <button
                  onClick={() => onOpenArea({ area: ws as ProjectWorkstream })}
                  className="flex flex-wrap items-center gap-x-3 text-sm hover:text-primary transition-colors"
                >
                  <StatusDot status={ws.status} />
                  <span className="text-foreground">{ws.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{ws.task_code}</span>
                  <span className="text-xs text-muted-foreground">{RYG_META[ws.status]?.label}</span>
                  {ws.due_date && <span className="text-xs text-muted-foreground">Due {formatDay(ws.due_date)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Recent activity</SectionTitle>
        {activity.length === 0 ? (
          <EmptyLine>No activity yet.</EmptyLine>
        ) : (
          <ul className="space-y-2.5">
            {activity.slice(0, 5).map((a) => (
              <li key={a.id} className="text-sm text-muted-foreground">
                <span className="text-foreground">{a.actor || "Someone"}</span> {a.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
