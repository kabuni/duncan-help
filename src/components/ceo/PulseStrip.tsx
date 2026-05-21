import { cn } from "@/lib/utils";

interface Cell {
  label: string;
  primary: string;
  primaryTone?: string;
  secondary?: string;
}

interface PulseStripProps {
  workstreamScores?: any[];
  hubspotSignal?: any;
  slackPulse?: any;
  emailPulse?: any;
  automationProgress?: any;
  payload?: any;
}

const fmt = (n: unknown) =>
  typeof n === "number" ? n.toLocaleString() : (n ? String(n) : "—");

const PulseStrip = ({
  workstreamScores = [],
  hubspotSignal,
  slackPulse,
  emailPulse,
  automationProgress,
  payload = {},
}: PulseStripProps) => {
  // Delivery: red/amber workstreams
  const red = workstreamScores.filter((w: any) => String(w?.rag).toLowerCase() === "red").length;
  const amber = workstreamScores.filter((w: any) => {
    const r = String(w?.rag).toLowerCase();
    return r === "amber" || r === "yellow";
  }).length;
  const green = workstreamScores.filter((w: any) => String(w?.rag).toLowerCase() === "green").length;

  // Hiring: try payload.hiring_signal, candidates_pulse, or leader signals
  const hiringOpen =
    payload?.hiring_signal?.open_roles ??
    payload?.recruitment?.open_roles ??
    null;
  const hiringMoved =
    payload?.hiring_signal?.candidates_moved ??
    payload?.recruitment?.candidates_moved ??
    null;

  // Comms: slack escalations + email backlog
  const slackEscalations =
    slackPulse?.escalations ??
    slackPulse?.signals?.escalations ??
    (Array.isArray(slackPulse?.signals) ? slackPulse.signals.length : null);
  const emailBacklog =
    emailPulse?.backlog ??
    emailPulse?.unread_threads ??
    emailPulse?.unread ??
    null;

  // Cash: xero numbers if surfaced
  const overdue =
    payload?.cash?.overdue_total ??
    payload?.xero?.overdue_balance ??
    null;
  const dueThisWeek =
    payload?.cash?.due_this_week ??
    payload?.xero?.due_this_week ??
    null;

  // Adoption
  const activeUsers = automationProgress?.company_usage?.active_users ?? null;
  const topUser = Array.isArray(automationProgress?.top_users)
    ? automationProgress.top_users[0]?.name?.split(" ")[0]
    : null;

  const cells: Cell[] = [
    {
      label: "Delivery",
      primary: red > 0 ? `${red} red` : amber > 0 ? `${amber} amber` : `${green} green`,
      primaryTone:
        red > 0 ? "text-red-500" : amber > 0 ? "text-yellow-500" : "text-green-500",
      secondary: `${workstreamScores.length} workstreams`,
    },
    {
      label: "Hiring",
      primary: fmt(hiringOpen) + (hiringOpen !== null ? " open" : ""),
      secondary: hiringMoved !== null ? `${fmt(hiringMoved)} moved 24h` : undefined,
    },
    {
      label: "Comms",
      primary: slackEscalations !== null ? `${fmt(slackEscalations)} escalations` : "—",
      primaryTone: typeof slackEscalations === "number" && slackEscalations > 0 ? "text-yellow-500" : undefined,
      secondary: emailBacklog !== null ? `${fmt(emailBacklog)} email backlog` : undefined,
    },
    {
      label: "Cash",
      primary: overdue !== null ? `£${fmt(overdue)} overdue` : "—",
      primaryTone: typeof overdue === "number" && overdue > 0 ? "text-red-500" : undefined,
      secondary: dueThisWeek !== null ? `£${fmt(dueThisWeek)} due wk` : undefined,
    },
    {
      label: "Adoption",
      primary: activeUsers !== null ? `${fmt(activeUsers)} active` : "—",
      secondary: topUser ? `top: ${topUser}` : undefined,
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {cells.map((c, i) => (
          <div
            key={i}
            className={cn(
              "p-3 sm:p-4 border-border",
              i > 0 && "border-t sm:border-t-0 sm:border-l",
              i >= 3 && "border-t lg:border-t-0 lg:border-l",
              i === 2 && "sm:border-t lg:border-t-0",
            )}
          >
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
              {c.label}
            </div>
            <div className={cn("text-sm sm:text-base font-semibold tabular-nums text-foreground", c.primaryTone)}>
              {c.primary}
            </div>
            {c.secondary && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{c.secondary}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PulseStrip;
