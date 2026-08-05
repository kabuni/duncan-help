import { useOperationalHealth } from "@/hooks/useOperationalHealth";

/**
 * Operational strip — live platform telemetry.
 * Data + sources live in src/hooks/useOperationalHealth.ts
 */
export default function OperationalStrip() {
  const { stats, isLoading, error } = useOperationalHealth();

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Operational telemetry is restricted to admins.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0">
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {isLoading ? "…" : s.value}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
