import { useProjectTasks } from "@/hooks/useProjectWork";

/**
 * Circular progress ring for a project. Computed from the real underlying
 * tasks (direct project tasks + tasks on its linked workstream cards) —
 * nothing is stored, it updates automatically as tasks complete.
 */
export function useProjectProgress(projectId: string | null) {
  const { data: tasks = [], isLoading } = useProjectTasks(projectId);
  const total = tasks.length;
  const done = tasks.filter((t) => t.completed).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, pct, isLoading };
}

export function ProjectProgressRing({
  pct, done, total, size = 96, stroke = 7,
}: {
  pct: number; done: number; total: number; size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Project progress: ${pct} percent, ${done} of ${total} tasks complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-secondary" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
          className="stroke-primary transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-foreground leading-none">{pct}%</span>
      </div>
    </div>
  );
}
