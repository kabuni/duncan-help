import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Globe2, TrendingUp, TrendingDown, Users, Briefcase, FolderKanban,
  AlertTriangle, Share2, BarChart3, ExternalLink, Loader2, CalendarCheck,
} from "lucide-react";
import {
  useGAHomeSummary, useHiresStats, useWorkstreamsStats, useProjectsStats, useSocialStats, useRsvpStats,
} from "@/hooks/useHomeDashboard";

const formatNumber = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

const Sparkline = ({ data }: { data: { date: string; hours: number }[] }) => {
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.hours), 1);
  const w = 100, h = 28;
  const pts = data
    .map((d, i) => `${(i / (data.length - 1)) * w},${h - (d.hours / max) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8 text-primary/70" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
};

const TileShell = ({
  children, className = "", delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.35 }}
    className={`rounded-xl border border-border bg-card p-4 sm:p-5 ${className}`}
  >
    {children}
  </motion.div>
);

const TileHeader = ({ icon: Icon, label, action }: any) => (
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </div>
    {action}
  </div>
);

const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div>
    <div className="text-lg font-bold text-foreground tracking-tight">{value}</div>
    <div className="text-[11px] text-muted-foreground">{label}</div>
    {hint && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</div>}
  </div>
);

const SHOWCASE_EVENT_ID = "e942181b-c52a-42a4-a0c2-1e2fdf499ed7";

function RsvpSummaryTile() {
  const { data, loading } = useRsvpStats(SHOWCASE_EVENT_ID);
  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  const s = data ?? { total: 0, confirmed: 0, maybe: 0, declined: 0, missingInfo: 0 };
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
      <Stat label="Total Registrations" value={s.total} />
      <Stat label="Confirmed" value={s.confirmed} />
      <Stat label="Maybe" value={s.maybe} />
      <Stat label="Declined" value={s.declined} />
      <Stat
        label="Missing Information"
        value={s.missingInfo}
        hint={s.missingInfo > 0 ? "Duncan has emailed attendees" : undefined}
      />
    </div>
  );
}

export const HomeDashboard = ({ userName }: { userName: string }) => {
  const navigate = useNavigate();
  const ga = useGAHomeSummary();
  const hires = useHiresStats();
  const ws = useWorkstreamsStats();
  const proj = useProjectsStats();
  const social = useSocialStats();

  const play = ga.data?.play;
  const web = ga.data?.website;
  const gaConnected = ga.data?.connected !== false;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 sm:space-y-4">
      {/* HERO — Hours of Play */}
      <TileShell className="relative overflow-hidden">
        <div className="absolute inset-0 gradient-radial opacity-40 pointer-events-none" />
        <div className="relative z-10">
          <TileHeader
            icon={Globe2}
            label="Hours of Play · Worldwide · Last 30d"
            action={
              !gaConnected ? (
                <button onClick={() => navigate("/integrations")} className="text-[10px] text-primary hover:underline">
                  Connect Analytics
                </button>
              ) : null
            }
          />
          {ga.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading global play data…
            </div>
          ) : !gaConnected ? (
            <div className="text-sm text-muted-foreground py-2">
              Connect Google Analytics to see hours of play around the world.
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <div className="text-3xl sm:text-5xl font-bold text-foreground tracking-tight">
                  {formatNumber(play?.hoursLast30 ?? 0)} <span className="text-base sm:text-xl font-medium text-muted-foreground">hrs</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs">
                  {play?.deltaPct !== null && play?.deltaPct !== undefined && (
                    <span className={`inline-flex items-center gap-1 font-medium ${play.deltaPct >= 0 ? "text-norman-success" : "text-destructive"}`}>
                      {play.deltaPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {Math.abs(play.deltaPct)}% vs prior 30d
                    </span>
                  )}
                  <span className="text-muted-foreground">· {play?.countriesToday ?? 0} countries today</span>
                </div>
              </div>
              <div className="w-full sm:w-64">
                <Sparkline data={play?.sparkline ?? []} />
                <div className="text-[10px] text-muted-foreground/70 text-right mt-1">Daily hours · last 30d</div>
              </div>
            </div>
          )}
        </div>
      </TileShell>

      {/* WEBSITE + SOCIAL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <TileShell delay={0.05}>
          <TileHeader
            icon={BarChart3}
            label="Website · kabuni.com · 7d"
            action={
              <button onClick={() => navigate("/operations")} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                Open <ExternalLink className="h-2.5 w-2.5" />
              </button>
            }
          />
          {ga.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !gaConnected ? (
            <div className="text-xs text-muted-foreground">Not connected.</div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Users" value={formatNumber(web?.activeUsers7d ?? 0)} />
              <Stat label="Sessions" value={formatNumber(web?.sessions7d ?? 0)} />
              <Stat label="Page views" value={formatNumber(web?.pageViews7d ?? 0)} />
              {web?.topPage && (
                <div className="col-span-3 text-[11px] text-muted-foreground truncate">
                  Top page: <span className="text-foreground font-medium">{web.topPage}</span>
                </div>
              )}
            </div>
          )}
        </TileShell>

        <TileShell delay={0.1}>
          <TileHeader
            icon={Share2}
            label={`Social · latest week${social.data?.fetchedAt ? ` · synced ${new Date(social.data.fetchedAt).toLocaleDateString()}` : ""}`}
          />
          {social.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !social.data?.accounts.length ? (
            <p className="text-xs text-muted-foreground">
              Waiting for Alex's social stats sheet to land in Duncan's inbox.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
              {social.data.accounts.map((a) => {
                const delta = a.delta_followers;
                return (
                  <div key={a.account} className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{a.account}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {[
                          a.likes != null && `${formatNumber(a.likes)} likes`,
                          a.comments != null && `${formatNumber(a.comments)} comments`,
                          a.shares != null && `${formatNumber(a.shares)} shares`,
                        ].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-foreground">
                        {a.followers != null ? formatNumber(a.followers) : "—"}
                      </div>
                      {delta != null && delta !== 0 && (
                        <div className={`text-[10px] inline-flex items-center gap-0.5 ${delta >= 0 ? "text-norman-success" : "text-destructive"}`}>
                          {delta >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                          {delta >= 0 ? "+" : ""}{formatNumber(delta)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TileShell>
      </div>

      {/* RSVP SUMMARY — Kabuni Showcase Mumbai */}
      <TileShell delay={0.125}>
        <TileHeader
          icon={CalendarCheck}
          label="Kabuni Showcase Mumbai · RSVP Status"
          action={
            <button
              onClick={() => navigate("/diary?event=e942181b-c52a-42a4-a0c2-1e2fdf499ed7")}
              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
            >
              Open <ExternalLink className="h-2.5 w-2.5" />
            </button>
          }
        />
        <RsvpSummaryTile />
      </TileShell>

      {/* HIRES / WORKSTREAMS / PROJECTS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <TileShell delay={0.15}>
          <TileHeader
            icon={Users}
            label="Hires"
            action={
              <button onClick={() => navigate("/recruitment")} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                Open <ExternalLink className="h-2.5 w-2.5" />
              </button>
            }
          />
          {hires.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-3">
              <Stat label="Open roles" value={hires.data?.openRoles ?? 0} />
              <Stat label="Candidates in pipeline" value={formatNumber(hires.data?.totalCandidates ?? 0)} />
              <Stat label="Interviews invited this week" value={hires.data?.interviewsThisWeek ?? 0} />
            </div>
          )}
        </TileShell>

        <TileShell delay={0.2}>
          <TileHeader
            icon={FolderKanban}
            label="Workstreams"
            action={
              <button onClick={() => navigate("/workstreams")} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                Open <ExternalLink className="h-2.5 w-2.5" />
              </button>
            }
          />
          {ws.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-baseline gap-3">
                <Stat label="Active" value={ws.data?.active ?? 0} />
                {(ws.data?.red ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 text-[10px] font-medium">
                    <AlertTriangle className="h-2.5 w-2.5" /> {ws.data?.red} red
                  </span>
                )}
              </div>
              <Stat label="Overdue" value={ws.data?.overdue ?? 0} />
              <Stat label="On track" value={`${ws.data?.onTrackPct ?? 0}%`} hint={`${ws.data?.myOpen ?? 0} assigned to ${userName}`} />
            </div>
          )}
        </TileShell>

        <TileShell delay={0.25}>
          <TileHeader
            icon={Briefcase}
            label="Projects"
            action={
              <button onClick={() => navigate("/projects")} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                Open <ExternalLink className="h-2.5 w-2.5" />
              </button>
            }
          />
          {proj.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-3">
              <Stat label="Active projects" value={proj.data?.active ?? 0} />
              <Stat label="Files indexed" value={formatNumber(proj.data?.filesIndexed ?? 0)} />
              <Stat label="Updated in last 24h" value={proj.data?.updatedToday ?? 0} />
            </div>
          )}
        </TileShell>
      </div>
    </div>
  );
};
