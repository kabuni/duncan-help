import { forwardRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { canViewBriefing, canGenerateBriefing } from "@/lib/ceoAccess";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Sparkles, Settings2, AlertTriangle, ShieldCheck, X, ChevronDown } from "lucide-react";
import { useCEOBriefing } from "@/hooks/useCEOBriefing";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import VerdictHero from "@/components/ceo/VerdictHero";
import PulseStrip from "@/components/ceo/PulseStrip";
import DoToday from "@/components/ceo/DoToday";
import RiskRadar from "@/components/ceo/RiskRadar";
import CoverageGaps from "@/components/ceo/CoverageGaps";
import CompanyPulseCard, { type CompanyPulseStatus } from "@/components/ceo/CompanyPulseCard";
import DataCoverageCard, { type DataCoverageAudit } from "@/components/ceo/DataCoverageCard";
import CommsPulseCard from "@/components/ceo/CommsPulseCard";
import CEORoutingPanel from "@/components/ceo/CEORoutingPanel";
import LovableContributorsCard from "@/components/ceo/LovableContributorsCard";

const Section = forwardRef<HTMLElement, { n: number; title: string; children: React.ReactNode; id?: string }>(
  ({ n, title, children, id }, ref) => (
    <section ref={ref} id={id} className="space-y-3">
      <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
        {String(n).padStart(2, "0")} · {title}
      </h2>
      {children}
    </section>
  )
);

Section.displayName = "Section";

interface ZoneProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Zone = ({ title, subtitle, defaultOpen = false, children }: ZoneProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card/50">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors rounded-lg">
        <div className="text-left">
          <h2 className="text-sm font-mono uppercase tracking-widest text-foreground">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 pt-2 space-y-5 border-t border-border/60">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

const CEOBriefing = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const type = "morning" as const;
  const { briefing, previous, loading, generating, generate, job, cancelPolling } = useCEOBriefing(type);
  const [showRouting, setShowRouting] = useState(false);

  if (authLoading) return null;
  if (!canViewBriefing(user?.email)) return <Navigate to="/" replace />;
  const canGenerate = canGenerateBriefing(user?.email) || isAdmin;

  const p = (briefing?.payload as any) || {};
  const today = briefing?.briefing_date ? new Date(briefing.briefing_date) : new Date();
  const dateLabel = today.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const probDelta = briefing && previous && typeof briefing.outcome_probability === "number" && typeof previous.outcome_probability === "number"
    ? briefing.outcome_probability - previous.outcome_probability : null;
  const execDelta = briefing && previous && typeof briefing.execution_score === "number" && typeof previous.execution_score === "number"
    ? briefing.execution_score - previous.execution_score : null;

  const workstreamScores = Array.isArray(briefing?.workstream_scores) ? (briefing!.workstream_scores as any[]) : [];

  return (
    <>
      <div className="mx-auto max-w-5xl w-full px-4 md:px-8 py-6 space-y-5 min-w-0 overflow-x-hidden">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 min-w-0">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Team Briefing</h1>
            <p className="text-sm text-muted-foreground font-mono">{dateLabel}</p>
            {!canGenerate && (
              <p className="text-xs text-muted-foreground mt-1">Read-only view. Generated daily by the CEO.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canGenerate && (job ? (
              <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 min-w-[280px]">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground truncate">{job.phase || "Working"}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-1 mt-1.5" />
                </div>
                <Button onClick={cancelPolling} size="icon" variant="ghost" className="h-6 w-6 shrink-0">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button onClick={generate} disabled={generating} size="sm">
                {generating ? <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
                {briefing ? "Regenerate" : "Generate"}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !briefing ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No {type} briefing yet for today.</p>
            {canGenerate ? (
              <Button onClick={generate} disabled={generating}>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate {type} briefing
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">The CEO will generate today's briefing shortly.</p>
            )}
          </div>
        ) : (
          <>
            {/* ===== ABOVE THE FOLD: Company State ===== */}
            <VerdictHero
              trajectory={briefing.trajectory}
              outcomeProbability={briefing.outcome_probability}
              probabilityDelta={probDelta}
              executionScore={briefing.execution_score}
              executionDelta={execDelta}
              coverageRatio={p.coverage_summary?.ratio ?? null}
              coverageCovered={p.coverage_summary?.covered ?? null}
              coverageTotal={p.coverage_summary?.total ?? null}
              confidenceWarning={p.confidence_warning?.reason ?? null}
              tldr={p.tldr}
            />

            <PulseStrip
              workstreamScores={workstreamScores}
              hubspotSignal={p.hubspot_signal}
              slackPulse={p.slack_pulse}
              emailPulse={p.email_pulse}
              automationProgress={p.automation_progress}
              payload={p}
            />

            <DoToday decisions={p.decisions || []} />

            {Array.isArray(p.available_workstreams) && p.available_workstreams.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No workstreams configured in Duncan — add cards under{" "}
                  <Link to="/workstreams" className="text-primary underline">Workstreams</Link>{" "}
                  to enable scoring.
                </p>
              </div>
            )}

            {/* ===== BELOW THE FOLD: 3 zones ===== */}

            {/* Zone 1 — Evidence */}
            <Zone title="Evidence" subtitle="Workstream scorecard, what changed, risks, decisions, accountability">
              {workstreamScores.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                    Workstream Scorecard
                  </h3>
                  <div className="rounded-lg border border-border bg-card overflow-x-auto">
                    <table className="w-full text-xs min-w-[720px]">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Workstream</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Cards</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Prog</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Conf</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Risk</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Framework axes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workstreamScores.map((w: any, i: number) => {
                          const rag = String(w?.rag || "").toLowerCase();
                          const dotClass =
                            rag === "red" ? "bg-red-500" :
                            rag === "amber" || rag === "yellow" ? "bg-yellow-500" :
                            rag === "green" ? "bg-green-500" :
                            "bg-muted-foreground/40";
                          return (
                            <tr key={i} className="border-t border-border align-top">
                              <td className="px-3 py-2 text-foreground font-medium">
                                <span className="inline-flex items-center gap-2">
                                  <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} title={rag || "unknown"} />
                                  {w.name}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                                {w.card_status_summary || "—"}
                              </td>
                              <td className="px-3 py-2 tabular-nums text-foreground">{w.progress ?? "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-foreground">{w.confidence ?? "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-foreground">{w.risk ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground space-y-1">
                                {w.progress_vs_goal && <div><span className="font-mono text-[10px] uppercase">Goal:</span> {w.progress_vs_goal}</div>}
                                {w.execution_quality && <div><span className="font-mono text-[10px] uppercase">Exec:</span> {w.execution_quality}</div>}
                                {w.commercial_impact && <div><span className="font-mono text-[10px] uppercase">$:</span> {w.commercial_impact}</div>}
                                {w.dependency_strength && <div><span className="font-mono text-[10px] uppercase">Deps:</span> {w.dependency_strength}</div>}
                                {w.evidence && <div className="text-[11px] italic">{w.evidence}</div>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <Section n={1} title="What Changed Yesterday">
                <div className="space-y-3">
                  {(p.what_changed && p.what_changed.length > 0) ? (
                    p.what_changed.map((g: any, i: number) => (
                      <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
                        <h4 className="text-sm font-semibold text-foreground">{g.function_area || g.function}</h4>
                        {g.moved && <p className="text-xs text-muted-foreground"><span className="text-green-500 font-mono">MOVED:</span> {g.moved}</p>}
                        {g.did_not_move && <p className="text-xs text-muted-foreground"><span className="text-yellow-500 font-mono">STALLED:</span> {g.did_not_move}</p>}
                        {g.needs_attention && <p className="text-xs text-muted-foreground"><span className="text-red-500 font-mono">ATTENTION:</span> {g.needs_attention}</p>}
                        {g.auto_injected && (
                          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 pt-1">
                            Auto-generated explanation · {g.auto_injected_reason || "fallback"}
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-card p-4 space-y-1">
                      <h4 className="text-sm font-semibold text-foreground">No structured movement reported</h4>
                      <p className="text-xs text-muted-foreground">
                        Duncan did not produce any rows for this section. This usually means the briefing was generated against a thin 24h window or an integration is silent.
                      </p>
                    </div>
                  )}
                </div>
              </Section>

              <Section n={2} title="Strategic Risk Radar">
                <RiskRadar risks={p.risks || []} reconciliation={p.risk_reconciliation || null} />
              </Section>

              <Section n={3} title="Decisions the CEO Must Make" id="decisions">
                {(() => {
                  const decisions = (p.decisions || []) as any[];
                  const trajectory = String(briefing.trajectory || "").toLowerCase();
                  const isGreen = trajectory.includes("on track");
                  if (decisions.length === 0) {
                    return (
                      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                        {isGreen
                          ? "No CEO-grade decisions outstanding — trajectory is on track and all priorities have accountable owners."
                          : "Duncan could not detect any CEO-grade decisions — verify visibility into priorities and inboxes."}
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      {decisions.map((d: any, i: number) => {
                        const conf = (d.confidence || "").toLowerCase();
                        const confClass =
                          conf === "high"
                            ? "border-green-500/40 text-green-600 dark:text-green-400"
                            : conf === "medium"
                            ? "border-yellow-500/40 text-yellow-600 dark:text-yellow-400"
                            : conf === "low"
                            ? "border-red-500/40 text-red-600 dark:text-red-400"
                            : "border-border text-muted-foreground";
                        const isAuto = !!d.auto_injected;
                        const cardClass = isAuto
                          ? "rounded-lg border border-l-4 border-l-amber-500/60 border-primary/30 bg-primary/5 p-4 space-y-2"
                          : "rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2";
                        return (
                          <div key={i} className={cardClass}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                              <h4 className="text-sm font-semibold text-foreground sm:flex-1 min-w-0 break-words">{i + 1}. {d.decision}</h4>
                              <div className="flex items-center gap-1.5 flex-wrap sm:shrink-0 sm:justify-end">
                                {isAuto && (
                                  <Badge variant="outline" className="text-[10px] font-mono uppercase border-amber-500/40 text-amber-600 dark:text-amber-400 whitespace-nowrap">
                                    Auto-flagged
                                  </Badge>
                                )}
                                {d.evidence_source && (
                                  <Badge variant="outline" className="text-[10px] font-mono uppercase border-border text-muted-foreground whitespace-nowrap">
                                    {String(d.evidence_source).replace(/_/g, " ")}
                                  </Badge>
                                )}
                                {conf && (
                                  <Badge variant="outline" className={`text-[10px] font-mono uppercase whitespace-nowrap ${confClass}`}>
                                    {conf} confidence
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{d.why_it_matters}</p>
                            {d.consequence && <p className="text-xs text-red-500">If ignored 7d: {d.consequence}</p>}
                            {d.who_to_involve && <p className="text-[11px] font-mono text-muted-foreground">Involve: {d.who_to_involve}</p>}
                            {d.blocked_by_missing_data && (
                              <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2.5 flex items-start gap-2">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <div className="flex-1 space-y-1.5">
                                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                    <span className="font-semibold">Decide blind?</span> {d.blocked_by_missing_data}
                                  </p>
                                  <Link
                                    to="/projects"
                                    className="text-[11px] font-mono text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    Upload to fix →
                                  </Link>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </Section>

              <Section n={4} title="Accountability Watchlist">
                {(p.watchlist || []).length === 0 ? (
                  <div className="rounded-lg border border-border bg-card p-6 flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">All workstreams green and fully evidenced</p>
                      <p className="text-xs text-muted-foreground mt-1">No accountability gaps detected.</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-card overflow-x-auto">
                    <table className="w-full text-xs min-w-[820px]">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Workstream</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Owner</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Status</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">What Good Looks Like</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Missing</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Blind Spot</th>
                          <th className="px-3 py-2 font-mono uppercase tracking-wider">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(p.watchlist || []).map((w: any, i: number) => (
                          <tr
                            key={i}
                            className={`border-t border-border align-top ${
                              w.auto_injected ? "border-l-2 border-l-amber-500/60 border-l-dashed bg-amber-500/[0.02]" : ""
                            }`}
                          >
                            <td className="px-3 py-2 text-foreground font-medium">{w.workstream}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              <div>{w.owner}</div>
                              {w.reassignment_reason && (
                                <Badge variant="outline" className="mt-1 text-[9px] font-mono uppercase border-amber-500/40 text-amber-600 dark:text-amber-400">
                                  Reassigned — single-owner cap
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{w.status}</td>
                            <td className="px-3 py-2 text-muted-foreground">{w.good_looks_like || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{w.missing}</td>
                            <td className="px-3 py-2">
                              {w.data_blind_spot ? (
                                <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                  <span className="text-[11px]">{w.data_blind_spot}</span>
                                </div>
                              ) : (
                                <span className="text-[11px] text-muted-foreground/60">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {w.auto_injected ? (
                                <Badge variant="outline" className="text-[9px] font-mono uppercase border-amber-500/40 text-amber-600 dark:text-amber-400">
                                  Auto-flagged
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[9px] font-mono uppercase border-border text-muted-foreground">
                                  AI
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </Zone>

            {/* Zone 2 — Signals */}
            <Zone title="Signals" subtitle="Comms pulse across Email, Slack, HubSpot, Azure Repos · company pulse">
              {p.company_pulse_status && (
                <CompanyPulseCard pulse={p.company_pulse_status as CompanyPulseStatus} />
              )}
              <CommsPulseCard
                emailPulse={p.email_pulse}
                slackPulse={p.slack_pulse}
                hubspotSignal={p.hubspot_signal}
                azureReposSignal={p.azure_repos_signal}
              />
            </Zone>

            {/* Zone 3 — Adoption & Coverage */}
            <Zone title="Adoption & Coverage" subtitle="Document intelligence, missing artifacts, Duncan adoption">
              {p.data_coverage_audit && (
                <DataCoverageCard
                  audit={p.data_coverage_audit as DataCoverageAudit}
                  documentIntelligence={Array.isArray(p.document_intelligence) ? p.document_intelligence : []}
                  missingArtifacts={Array.isArray(p.missing_artifacts_recommendations) ? p.missing_artifacts_recommendations : []}
                  missingArtifactsSummary={p.missing_artifacts_summary}
                />
              )}
              <CoverageGaps gaps={p.coverage_gaps} totalPriorities={6} summary={p.coverage_summary} />
              <LovableContributorsCard />
              {p.brutal_truth && (
                <div className="rounded-lg border-2 border-red-500/40 bg-red-500/5 p-5">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-red-500/80 mb-2">One brutal truth</h3>
                  <p className="text-sm font-medium text-foreground leading-relaxed">{p.brutal_truth}</p>
                </div>
              )}
            </Zone>

            <p className="text-[10px] font-mono text-muted-foreground/60 text-center pt-4">
              Generated {new Date(briefing.created_at).toLocaleString("en-GB")} · Locked to CEO
            </p>

            <div className="pt-4 border-t border-border">
              <button
                onClick={() => setShowRouting((v) => !v)}
                className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center gap-1.5"
              >
                <Settings2 className="h-3 w-3" />
                {showRouting ? "Hide" : "Show"} action routing
              </button>
              {showRouting && <div className="mt-3"><CEORoutingPanel /></div>}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default CEOBriefing;
