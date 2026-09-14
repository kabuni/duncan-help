import { useProjectActivity } from "@/hooks/useProjectWork";
import { EmptyLine } from "./shared";

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

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Activity</h2>
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
    </div>
  );
}
