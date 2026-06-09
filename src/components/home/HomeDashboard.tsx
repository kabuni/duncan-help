import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Globe2, TrendingUp, TrendingDown, Users, Briefcase, FolderKanban,
  AlertTriangle, Share2, BarChart3, ExternalLink, Loader2, CalendarCheck, ListChecks, PoundSterling,
} from "lucide-react";
import {
  useGAHomeSummary, useHiresStats, useWorkstreamsStats, useProjectsStats, useSocialStats, useRsvpStats, useMyPendingTasks,
  useHubSpotSocialFeed,
} from "@/hooks/useHomeDashboard";

const formatNumber = (n: number | undefined | null) => {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
};

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

const STATUS_STYLES: Record<string, string> = {
  red: "bg-destructive/10 text-destructive border-destructive/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  not_started: "bg-muted text-muted-foreground border-border",
  done: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<string, string> = {
  red: "Off track",
  amber: "At risk",
  green: "On track",
  not_started: "Not started",
  done: "Done",
};

function MyPendingTasksTile() {
  const navigate = useNavigate();
  const { data, isLoading } = useMyPendingTasks();
  const tasks = (data ?? []).slice(0, 8);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <TileShell delay={0.13}>
      <TileHeader
        icon={ListChecks}
        label={`My Pending Tasks${data?.length ? ` · ${data.length}` : ""}`}
        action={
          <button
            onClick={() => navigate("/workstreams")}
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          >
            Open <ExternalLink className="h-2.5 w-2.5" />
          </button>
        }
      />
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pending tasks. You're all clear.</p>
      ) : (
        <div className="divide-y divide-border/40">
          {tasks.map((t) => {
            const due = t.due_date ? new Date(t.due_date + "T00:00:00") : null;
            const overdue = due ? due < today : false;
            return (
              <button
                key={t.id}
                onClick={() => navigate(`/workstreams?card=${t.card_id}`)}
                className="w-full text-left flex items-center gap-3 py-2 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground truncate">{t.title}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{t.card_title}</div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${STATUS_STYLES[t.status] || STATUS_STYLES.not_started}`}>
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                  <span className={`text-[10px] tabular-nums ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                    {due ? due.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </TileShell>
  );
}

function HubSpotSocialFeedTile() {
  const { data, isLoading } = useHubSpotSocialFeed();
  const channels = data?.channels ?? [];
  const posts = data?.posts ?? [];

  const errorText = data?.errors ? Object.values(data.errors).join(" · ") : null;
  const missingScope = errorText?.includes("social-access");

  return (
    <TileShell delay={0.115}>
      <TileHeader icon={Share2} label="HubSpot · Social" />
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : data?.status === "not_configured" ? (
        <p className="text-xs text-muted-foreground">HubSpot is not connected.</p>
      ) : missingScope ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            HubSpot social feed is unavailable because the connected token is missing the{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground">social-access</code> scope.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            Add the <span className="font-medium">Social</span> permission to the HubSpot Private App
            (Settings → Integrations → Private Apps), then reconnect.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {channels.map((c) => (
                <span
                  key={c.guid}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground"
                >
                  <span className="font-medium">{c.platform}</span>
                  <span className="text-muted-foreground">· {c.name}</span>
                </span>
              ))}
            </div>
          )}
          {posts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {channels.length === 0
                ? "No connected channels found in HubSpot."
                : "No posts published via HubSpot yet."}
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {posts.map((p) => (
                <div
                  key={p.id}
                  className="border-b border-border/40 pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {p.platform}
                      {p.channel && p.channel !== "—" ? ` · ${p.channel}` : ""}
                    </span>
                    <span>
                      {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : "—"}
                    </span>
                  </div>
                  {p.body && (
                    <div className="mt-1 text-xs text-foreground leading-snug line-clamp-3">
                      {p.body}
                    </div>
                  )}
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                    >
                      View post <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/70">
            Engagement metrics (followers, likes, shares) are not exposed by HubSpot's API.
          </p>
        </div>
      )}
    </TileShell>
  );
}



function GbpInrRateTile() {
  const [rate, setRate] = useState<number | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchRate = async () => {
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/GBP");
        const json = await res.json();
        if (cancelled) return;
        const inr = json?.rates?.INR;
        if (typeof inr !== "number") throw new Error("no rate");
        setPrev((p) => (rate !== null ? rate : p));
        setRate(inr);
        setUpdatedAt(json?.time_last_update_utc ?? new Date().toUTCString());
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchRate();
    const id = setInterval(fetchRate, 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const delta = rate !== null && prev !== null ? rate - prev : null;

  return (
    <TileShell delay={0.04}>
      <TileHeader icon={PoundSterling} label="GBP → INR · Exchange Rate" />
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : error || rate === null ? (
        <div className="text-xs text-muted-foreground">Rate unavailable right now.</div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
              ₹{rate.toFixed(2)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              per £1 · {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
            </div>
          </div>
          {delta !== null && delta !== 0 && (
            <div className={`text-[11px] inline-flex items-center gap-0.5 font-medium ${delta >= 0 ? "text-norman-success" : "text-destructive"}`}>
              {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {delta >= 0 ? "+" : ""}{delta.toFixed(4)}
            </div>
          )}
        </div>
      )}
    </TileShell>
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
                <button onClick={() => navigate("/settings?tab=integrations")} className="text-[10px] text-primary hover:underline">
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

      {/* GBP → INR EXCHANGE RATE */}
      <GbpInrRateTile />

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
              {web?.trackedPages && web.trackedPages.length > 0 && (
                <div className="col-span-3 mt-2 pt-2 border-t border-border/40 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tracked pages</div>
                  {web.trackedPages.map((p) => (
                    <div key={p.path} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="text-foreground font-medium truncate">{p.label}</div>
                        <div className="text-muted-foreground truncate">{p.path}</div>
                      </div>
                      <div className="text-right shrink-0 leading-tight">
                        <div className="text-foreground font-semibold">{formatNumber(p.pageViewsToday)} <span className="text-muted-foreground font-normal">· today</span></div>
                        <div className="text-muted-foreground">
                          {formatNumber(p.pageViewsYesterday)} · yest
                          {p.deltaPct != null && !Number.isNaN(p.deltaPct) && (
                            <span className={`ml-1.5 font-medium ${p.deltaPct >= 0 ? "text-norman-success" : "text-destructive"}`}>
                              {p.deltaPct >= 0 ? "+" : ""}{p.deltaPct}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
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

      {/* HUBSPOT SOCIAL FEED — temporarily hidden */}
      {false && <HubSpotSocialFeedTile />}


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

      {/* MY PENDING TASKS */}
      <MyPendingTasksTile />

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
