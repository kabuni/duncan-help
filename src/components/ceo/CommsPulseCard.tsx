import { Mail, Hash, AlertTriangle, MessageSquareWarning, Inbox, MailMinus, Info, Slack, Database, GitBranch, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { isCEO } from "@/lib/ceoAccess";
import type { EmailPulseSummary, LeadershipStatusEntry } from "./EmailPulseCard";

export interface SlackPulseSummary {
  window_hours?: number;
  degraded?: boolean;
  degraded_reason?: string | null;
  degraded_codes?: string[];
  visibility_scope?: "full_public" | "public_only" | "partial" | "not_configured";
  channels_total?: number;
  channels_member?: number;
  channels_eligible?: number;
  channels_scanned?: number;
  messages_analysed?: number;
  not_member_channels_count?: number;
  inaccessible_private_channels_count?: number;
  history_failures_count?: number;
  channels_with_errors?: Array<{ channel: string; reason: string }>;
  per_channel?: Array<{
    channel: string;
    status: string;
    status_reason?: string | null;
    messages_scanned: number;
    commitments: number;
    escalations: number;
    confusion: number;
    customer_issues: number;
    risks: number;
  }>;
  silent_channels?: Array<{ channel: string; reason: string }>;
  not_member_channels?: Array<{ id: string; name: string; is_private?: boolean }>;
  counts?: {
    commitments: number;
    unowned_commitments: number;
    escalations: number;
    confusion: number;
    customer_issues: number;
    risks: number;
    critical_risks: number;
  };
}

interface Props {
  emailPulse: EmailPulseSummary | null | undefined;
  slackPulse: SlackPulseSummary | null | undefined;
  hubspotSignal?: {
    status?: string;
    connected?: boolean;
    credential_source?: string | null;
    verification_path?: string | null;
    last_sync_at?: string | null;
    last_verified_at?: string | null;
    error_code?: string | null;
    error_message?: string | null;
    metrics_summary?: string | null;
    accounts_scanned?: number;
    stale_deals?: number;
    at_risk_accounts?: number;
    active_deals_count?: number;
    active_deals?: Array<{
      id?: string;
      name?: string;
      stage?: string;
      amount?: number;
      owner_label?: string;
      close_date?: string | null;
      company_name?: string;
    }>;
    at_risk_accounts_count?: number;
    at_risk_accounts_details?: Array<{
      account_name?: string;
      risk_reasons?: string[];
      deal_name?: string;
      stage?: string;
      owner_label?: string;
    }>;
    key_contacts?: Array<{
      id?: string;
      name?: string;
      email?: string | null;
      company?: string | null;
      lifecycle_stage?: string | null;
      owner_label?: string;
      associated_deal_name?: string | null;
    }>;
    customer_escalations?: number;
    summary?: string | null;
    degraded_reason?: string | null;
    lists?: Array<{
      requested_name: string;
      list_id?: string | null;
      matched_name?: string | null;
      member_count?: number | null;
      processing_type?: string | null;
      updated_at?: string | null;
      error?: string | null;
    }>;
    form_metrics?: {
      newsletter?: { form_name?: string | null; total?: number; last_30d?: number; found?: boolean };
      scout?: { form_name?: string | null; total?: number; last_30d?: number; found?: boolean };
      location_breakdown?: Array<{ location: string; newsletter_count: number; scout_count: number }>;
    } | null;
  } | null;
  azureReposSignal?: {
    status?: string;
    connected?: boolean;
    credential_source?: string | null;
    verification_path?: string | null;
    last_sync_at?: string | null;
    last_verified_at?: string | null;
    error_code?: string | null;
    error_message?: string | null;
    metrics_summary?: string | null;
    repos_scanned?: number;
    open_prs?: number;
    blocked_prs?: number;
    stale_prs?: number;
    release_risks?: number;
    summary?: string | null;
    degraded_reason?: string | null;
    commits_7d?: number;
    files_added_7d?: number;
    files_removed_7d?: number;
    active_contributors_7d?: number;
    contributors_7d?: Array<{
      author: string;
      email?: string;
      commits: number;
      files_added: number;
      files_edited: number;
      files_removed: number;
      lines_changed: number;
      repos?: string[];
      commits_prev_7d: number;
      trend: "up" | "down" | "flat";
    }>;
    top_contributor?: { author: string; commits: number; lines_changed: number } | null;
    prev_window?: {
      commits_7d?: number;
      files_added_7d?: number;
      files_removed_7d?: number;
      active_contributors_7d?: number;
      since?: string;
      until?: string;
    } | null;
    wow?: {
      commits_delta?: number; commits_pct?: number;
      files_added_delta?: number; files_added_pct?: number;
      files_removed_delta?: number; files_removed_pct?: number;
      contributors_delta?: number;
      trend?: "up" | "down" | "flat";
    } | null;
  } | null;
}

type HubspotSignal = NonNullable<Props["hubspotSignal"]>;
type HubspotActiveDeal = NonNullable<HubspotSignal["active_deals"]>[number];
type HubspotAtRiskAccount = NonNullable<HubspotSignal["at_risk_accounts_details"]>[number];
type HubspotKeyContact = NonNullable<HubspotSignal["key_contacts"]>[number];

function ExternalSignalColumn({
  title,
  icon: Icon,
  signal,
  primaryMetric,
  secondaryMetric,
}: {
  title: string;
  icon: typeof Database;
  signal: Record<string, unknown> | null | undefined;
  primaryMetric: { label: string; value: string | number };
  secondaryMetric: { label: string; value: string | number };
}) {
  const status = String(signal?.status || "not_configured");
  const credentialSource = typeof signal?.credential_source === "string" ? signal.credential_source : null;
  const verificationPath = typeof signal?.verification_path === "string" ? signal.verification_path : null;
  const summary = typeof signal?.summary === "string" ? signal.summary : null;
  const metricsSummary = typeof signal?.metrics_summary === "string" ? signal.metrics_summary : null;
  const degradedReason = typeof signal?.degraded_reason === "string"
    ? signal.degraded_reason
    : typeof signal?.error_message === "string"
    ? signal.error_message
    : null;
  const errorCode = typeof signal?.error_code === "string" ? signal.error_code : null;
  const lastSyncAt = typeof signal?.last_sync_at === "string"
    ? signal.last_sync_at
    : typeof signal?.last_verified_at === "string"
    ? signal.last_verified_at
    : null;
  const tone = status === "connected"
    ? "border-border bg-card"
    : status === "degraded"
    ? "border-amber-500/40 bg-amber-500/5"
    : "border-dashed border-border bg-muted/20";
  const formattedLastSync = (() => {
    if (!lastSyncAt) return null;
    const date = new Date(lastSyncAt);
    return Number.isNaN(date.getTime()) ? lastSyncAt : date.toLocaleString();
  })();
  const sourceLabel = credentialSource === "connector_gateway"
    ? "Connector"
    : credentialSource === "stored_token"
    ? "Stored token"
    : credentialSource === "env_secret"
    ? "Env secret"
    : "No credential";
  const hubspotSignal = title === "HubSpot" ? (signal as HubspotSignal | null | undefined) : null;
  const activeDeals = Array.isArray(hubspotSignal?.active_deals) ? hubspotSignal.active_deals : [];
  const atRiskAccounts = Array.isArray(hubspotSignal?.at_risk_accounts_details) ? hubspotSignal.at_risk_accounts_details : [];
  const keyContacts = Array.isArray(hubspotSignal?.key_contacts) ? hubspotSignal.key_contacts : [];
  const hubspotStatus = hubspotSignal?.status ?? "not_configured";
  const hubspotEmptyTone = hubspotStatus === "not_configured"
    ? "HubSpot is not connected, so Team Briefing has no CRM signal here."
    : hubspotStatus === "degraded"
    ? hubspotSignal?.degraded_reason || "HubSpot returned partial CRM data for this run."
    : "No material CRM items surfaced for this run.";

  return (
    <div className={`rounded border p-3 space-y-2.5 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-foreground">{title}</span>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          {status.replace(/_/g, " ")}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div>
          <MetricLabel label={primaryMetric.label} tooltip={`${title} primary runtime metric shown exactly as persisted in the latest briefing payload.`} />
          <div className="text-foreground tabular-nums mt-0.5">{primaryMetric.value}</div>
        </div>
        <div>
          <MetricLabel label={secondaryMetric.label} tooltip={`${title} secondary runtime metric shown exactly as persisted in the latest briefing payload.`} />
          <div className="text-foreground tabular-nums mt-0.5">{secondaryMetric.value}</div>
        </div>
      </div>

      <div className="space-y-1 text-[10px] text-muted-foreground">
        <div>Source: {sourceLabel}</div>
        {formattedLastSync ? <div>Last sync: {formattedLastSync}</div> : null}
        {degradedReason ? <div>Reason: {degradedReason}</div> : null}
        {errorCode ? <div>Code: {errorCode}</div> : null}
        {verificationPath ? <div>Check: {verificationPath}</div> : null}
      </div>

      <div className="text-[11px] leading-relaxed text-muted-foreground">
        {metricsSummary || summary || (status === "not_configured"
          ? `${title} is not connected, so Team Briefing is explicitly operating with a blind spot here.`
          : degradedReason || `${title} returned no narrative summary for this run.`)}
      </div>

      {hubspotSignal ? (
        <div className="space-y-3 border-t border-border/70 pt-3">
          {hubspotSignal.form_metrics ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {(["newsletter", "scout"] as const).map((key) => {
                  const fm = hubspotSignal.form_metrics?.[key];
                  const label = key === "newsletter" ? "Newsletter signups" : "Scout submissions";
                  return (
                    <div key={key} className="rounded border border-border bg-background/60 p-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                      {fm?.found ? (
                        <>
                          <div className="mt-0.5 flex items-baseline gap-1.5">
                            <span className="text-base font-semibold tabular-nums text-foreground">{(fm.total ?? 0).toLocaleString()}</span>
                            <span className="text-[10px] text-muted-foreground">total</span>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-xs font-medium tabular-nums text-foreground">{(fm.last_30d ?? 0).toLocaleString()}</span>
                            <span className="text-[10px] text-muted-foreground">last 30d</span>
                          </div>
                          {fm.form_name ? <div className="text-[10px] text-muted-foreground truncate mt-0.5">{fm.form_name}</div> : null}
                        </>
                      ) : (
                        <div className="text-[10px] text-muted-foreground mt-1">Form not found in connected portal</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {(hubspotSignal.form_metrics.location_breakdown?.length ?? 0) > 0 ? (
                <div className="rounded border border-border bg-background/60 overflow-hidden">
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    Location breakdown (last 30d)
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left font-normal px-2.5 py-1.5">Location</th>
                        <th className="text-right font-normal px-2.5 py-1.5">Newsletter</th>
                        <th className="text-right font-normal px-2.5 py-1.5">Scout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hubspotSignal.form_metrics.location_breakdown!.map((row, idx) => (
                        <tr key={`${row.location}-${idx}`} className="border-b border-border last:border-0">
                          <td className="px-2.5 py-1.5 text-foreground">{row.location}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-foreground">{row.newsletter_count.toLocaleString()}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-foreground">{row.scout_count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active deals</div>
                <Badge variant="outline" className="text-[10px] font-mono">{Number(hubspotSignal.active_deals_count ?? activeDeals.length)}</Badge>
              </div>
              {activeDeals.length > 0 ? (
                <div className="space-y-2">
                  {activeDeals.slice(0, 5).map((deal, idx) => (
                    <div key={`${deal?.id || deal?.name || "deal"}-${idx}`} className="rounded border border-border bg-background/60 p-2.5 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">{deal?.name || "Unnamed deal"}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{deal?.company_name || "Unlinked account"}</div>
                        </div>
                        {deal?.stage ? <Badge variant="outline" className="text-[10px] font-mono shrink-0">{deal.stage}</Badge> : null}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        {formatCompactCurrency(deal?.amount) ? <span>{formatCompactCurrency(deal?.amount)}</span> : null}
                        {deal?.owner_label ? <span>{deal.owner_label}</span> : null}
                        {formatCompactDate(deal?.close_date) ? <span>Closes {formatCompactDate(deal?.close_date)}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-border bg-muted/20 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {hubspotEmptyTone}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">At-risk accounts</div>
                <Badge variant="outline" className="text-[10px] font-mono">{Number(hubspotSignal.at_risk_accounts_count ?? hubspotSignal.at_risk_accounts ?? atRiskAccounts.length)}</Badge>
              </div>
              {atRiskAccounts.length > 0 ? (
                <div className="space-y-2">
                  {atRiskAccounts.slice(0, 5).map((account, idx) => (
                    <div key={`${account?.account_name || "account"}-${idx}`} className="rounded border border-border bg-background/60 p-2.5 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-medium text-foreground truncate">{account?.account_name || "Unknown account"}</div>
                        {account?.stage ? <Badge variant="outline" className="text-[10px] font-mono shrink-0">{account.stage}</Badge> : null}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {(account?.risk_reasons || []).join(" · ") || "Risk signal not specified"}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        {account?.deal_name ? <span>{account.deal_name}</span> : null}
                        {account?.owner_label ? <span>{account.owner_label}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-border bg-muted/20 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {hubspotEmptyTone}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Key contacts</div>
                <Badge variant="outline" className="text-[10px] font-mono">{keyContacts.length}</Badge>
              </div>
              {keyContacts.length > 0 ? (
                <div className="space-y-2">
                  {keyContacts.slice(0, 5).map((contact, idx) => (
                    <div key={`${contact?.id || contact?.email || contact?.name || "contact"}-${idx}`} className="rounded border border-border bg-background/60 p-2.5 space-y-1">
                      <div className="text-xs font-medium text-foreground truncate">{contact?.name || "Unnamed contact"}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {[contact?.company, contact?.email].filter(Boolean).join(" · ") || "No company or email provided"}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        {contact?.lifecycle_stage ? <span>{contact.lifecycle_stage}</span> : null}
                        {contact?.owner_label ? <span>{contact.owner_label}</span> : null}
                        {contact?.associated_deal_name ? <span>{contact.associated_deal_name}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-border bg-muted/20 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {hubspotEmptyTone}
                </div>
              )}
            </div>

            {(() => {
              const lists = Array.isArray(hubspotSignal?.lists) ? hubspotSignal.lists : [];
              const found = lists.filter((l) => l?.matched_name).length;
              const total = lists.length;
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Marketing forms</div>
                    <Badge variant="outline" className="text-[10px] font-mono">{total > 0 ? `${found}/${total}` : "0"}</Badge>
                  </div>
                  {total > 0 ? (
                    <div className="space-y-2">
                      {lists.map((list, idx) => {
                        const isFound = !!list?.matched_name;
                        const hasError = !!list?.error;
                        const tone = hasError
                          ? "border-amber-500/40 bg-amber-500/5"
                          : isFound
                          ? "border-border bg-background/60"
                          : "border-dashed border-border bg-muted/20";
                        const proc = (list?.processing_type || "").toUpperCase();
                        const procLabel = proc === "DYNAMIC" ? "Dynamic" : proc === "MANUAL" || proc === "STATIC" ? "Static" : proc ? proc.toLowerCase() : null;
                        return (
                          <div key={`${list?.requested_name}-${idx}`} className={`rounded border p-2.5 space-y-1 ${tone}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-foreground truncate">{list?.requested_name}</div>
                                {isFound && list?.matched_name && list.matched_name !== list.requested_name ? (
                                  <div className="text-[10px] text-muted-foreground truncate">Matched: {list.matched_name}</div>
                                ) : null}
                              </div>
                              {procLabel ? <Badge variant="outline" className="text-[10px] font-mono shrink-0">{procLabel}</Badge> : null}
                            </div>
                            {hasError ? (
                              <div className="text-[10px] text-amber-600 dark:text-amber-400">Lookup failed: {list?.error}</div>
                            ) : isFound ? (
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-base font-semibold tabular-nums text-foreground">
                                  {(typeof list?.member_count === "number" ? list.member_count : 0).toLocaleString()}
                                </span>
                                <span className="text-[10px] text-muted-foreground">submissions</span>
                              </div>
                            ) : (
                              <div className="text-[10px] text-muted-foreground">Not found in connected portal</div>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded border border-dashed border-border bg-muted/20 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      {hubspotEmptyTone}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 cursor-help">
          {label}
          <Info className="h-2.5 w-2.5 opacity-60" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function formatCompactDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatCompactCurrency(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function LeadershipGroup({
  title,
  tone,
  hint,
  entries,
}: {
  title: string;
  tone: "amber" | "muted";
  hint?: string;
  entries: LeadershipStatusEntry[];
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  if (entries.length === 0) return null;

  const wrapperClass =
    tone === "amber"
      ? "rounded border border-amber-500/40 bg-amber-500/5 p-2.5"
      : "rounded border border-border bg-muted/30 p-2.5";
  const labelClass =
    tone === "amber"
      ? "text-[11px] font-mono uppercase text-amber-600 dark:text-amber-400"
      : "text-[11px] font-mono uppercase text-muted-foreground";
  const Icon = tone === "amber" ? MessageSquareWarning : MailMinus;
  const iconClass =
    tone === "amber"
      ? "h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
      : "h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5";

  return (
    <div className={wrapperClass}>
      <div className="flex items-start gap-2">
        <Icon className={iconClass} />
        <div className="flex-1 min-w-0">
          <div className={labelClass}>
            {title} ({entries.length}){hint ? <span className="ml-1 normal-case text-muted-foreground">· {hint}</span> : null}
          </div>
          <div className="mt-1.5 space-y-1">
            {entries.map((e, i) => (
              <button
                key={`${e.leader}-${i}`}
                type="button"
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                className="w-full text-left text-xs leading-tight hover:bg-background/50 rounded px-1 py-0.5 transition-colors"
              >
                <span className="font-medium text-foreground">{e.leader}</span>
                {e.email && (
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                    {e.email}
                  </span>
                )}
                {expandedIdx === i && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground italic">
                    {e.reason}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailColumn({ pulse }: { pulse: EmailPulseSummary | null | undefined }) {
  const [showOptedOut, setShowOptedOut] = useState(false);

  if (!pulse || !pulse.per_mailbox) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <Mail className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
          <div>
            <div className="text-[11px] font-mono uppercase text-muted-foreground">Email</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              No email pulse — no opted-in mailboxes, or the scan did not run.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const c = pulse.counts || {
    commitments: 0,
    risks: 0,
    critical_risks: 0,
    escalations: 0,
    board_mentions: 0,
    customer_issues: 0,
    vendor_signals: 0,
    unowned_commitments: 0,
  };
  const eligible = pulse.mailboxes_eligible ?? 0;
  const total = pulse.mailboxes_total ?? 0;
  const optedOut = pulse.mailboxes_skipped_optout ?? Math.max(0, total - eligible);

  return (
    <div className="rounded border border-border bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-foreground">Email</span>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          {pulse.emails_analysed ?? 0} emails
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div>
          <MetricLabel
            label="Mailboxes"
            tooltip="Connected Gmail accounts opted in to the pulse vs total connected. Opt-out is per user in Settings → Gmail."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            {eligible} of {total}
            {optedOut > 0 && (
              <button
                type="button"
                onClick={() => setShowOptedOut((v) => !v)}
                className="ml-1 text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
              >
                ({optedOut} opted out)
              </button>
            )}
          </div>
          {showOptedOut && optedOut > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {pulse.opted_out_mailboxes && pulse.opted_out_mailboxes.length > 0 ? (
                pulse.opted_out_mailboxes.map((m, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground leading-tight">
                    {m.display_name && <span className="text-foreground">{m.display_name}</span>}
                    {m.display_name && m.email && <span> · </span>}
                    {m.email && <span className="font-mono">{m.email}</span>}
                  </div>
                ))
              ) : (
                <div className="text-[10px] text-muted-foreground italic">Names unavailable.</div>
              )}
            </div>
          )}
        </div>
        <div>
          <MetricLabel
            label="Commitments"
            tooltip="Concrete promises an owner made in email in the last 24h. 'Unowned' means no clear person took responsibility."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            {c.commitments}
            {c.unowned_commitments > 0 && (
              <span className="text-amber-600 dark:text-amber-400"> · {c.unowned_commitments} unowned</span>
            )}
          </div>
        </div>
        <div>
          <MetricLabel
            label="Risks raised"
            tooltip="Material risks surfaced in email (severity ≥ medium counts toward critical), filtered to 2026 priorities or finance/legal/customers."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            {c.risks}
            {c.critical_risks > 0 && (
              <span className="text-red-600 dark:text-red-400"> · {c.critical_risks} critical</span>
            )}
          </div>
        </div>
        <div>
          <MetricLabel
            label="Board / Customers"
            tooltip="Board mentions (investor/board references) over customer issues (named customer problems)."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            {c.board_mentions} / {c.customer_issues}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlackColumn({ pulse }: { pulse: SlackPulseSummary | null | undefined }) {
  const [showSilent, setShowSilent] = useState(false);
  const [showNotMember, setShowNotMember] = useState(false);

  if (!pulse) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <Slack className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
          <div>
            <div className="text-[11px] font-mono uppercase text-muted-foreground">Slack</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Slack pulse did not run on this briefing — connector unavailable or scan failed.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const c = pulse.counts || {
    commitments: 0,
    unowned_commitments: 0,
    escalations: 0,
    confusion: 0,
    customer_issues: 0,
    risks: 0,
    critical_risks: 0,
  };
  const scanned = pulse.channels_scanned ?? 0;
  const member = pulse.channels_member ?? 0;
  const total = pulse.channels_total ?? 0;
  const notMember = pulse.not_member_channels_count ?? pulse.not_member_channels?.length ?? Math.max(0, total - member);
  const silent = pulse.silent_channels || [];
  const degraded = !!pulse.degraded;
  const degradedLabel = pulse.visibility_scope === "not_configured"
    ? "Connector not configured"
    : pulse.visibility_scope === "public_only"
    ? "Public channels only"
    : pulse.visibility_scope === "partial"
    ? "Partial channel visibility"
    : "Reduced coverage";

  return (
    <div className="rounded border border-border bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Slack className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-foreground">Slack</span>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          {pulse.messages_analysed ?? 0} msgs
        </Badge>
      </div>

      {degraded && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
          {degradedLabel}.
          {pulse.degraded_reason ? <span className="block mt-0.5 text-muted-foreground">{pulse.degraded_reason}</span> : null}
          {!!pulse.degraded_codes?.length && <span className="block mt-0.5 text-muted-foreground">{pulse.degraded_codes.join(" · ")}</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div>
          <MetricLabel
            label="Channels"
            tooltip="Duncan is in N of M channels. Only channels Duncan is a member of are scanned. Invite the bot to a channel to make it visible to the briefing."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            Duncan in {member} of {total}
            {notMember > 0 && (
              <button
                type="button"
                onClick={() => setShowNotMember((v) => !v)}
                className="ml-1 text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
              >
                ({notMember} not invited)
              </button>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            Scanned: {scanned}
          </div>
          {(pulse.inaccessible_private_channels_count || pulse.history_failures_count) ? (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {pulse.inaccessible_private_channels_count ? `${pulse.inaccessible_private_channels_count} private hidden` : null}
              {pulse.inaccessible_private_channels_count && pulse.history_failures_count ? " · " : null}
              {pulse.history_failures_count ? `${pulse.history_failures_count} channel fetch failures` : null}
            </div>
          ) : null}
          {showNotMember && pulse.not_member_channels && pulse.not_member_channels.length > 0 && (
            <div className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
              {pulse.not_member_channels.slice(0, 20).map((ch, i) => (
                <div key={i} className="text-[10px] text-muted-foreground leading-tight font-mono">
                  #{ch.name}{ch.is_private ? " 🔒" : ""}
                </div>
              ))}
              {pulse.not_member_channels.length > 20 && (
                <div className="text-[10px] text-muted-foreground italic">
                  +{pulse.not_member_channels.length - 20} more
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <MetricLabel
            label="Commitments"
            tooltip="Concrete promises a person made in a Slack channel in the last 24h."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            {c.commitments}
            {c.unowned_commitments > 0 && (
              <span className="text-amber-600 dark:text-amber-400"> · {c.unowned_commitments} unowned</span>
            )}
          </div>
        </div>
        <div>
          <MetricLabel
            label="Escalations"
            tooltip="Threads with ≥3 messages from ≥2 people showing repeated follow-ups WITHOUT resolution."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            {c.escalations}
            {c.confusion > 0 && (
              <span className="text-amber-600 dark:text-amber-400"> · {c.confusion} confusion</span>
            )}
          </div>
        </div>
        <div>
          <MetricLabel
            label="Customers / Risks"
            tooltip="Named customer issues raised in channels / material risks flagged in chat (critical = severity ≥ high)."
          />
          <div className="text-foreground tabular-nums mt-0.5">
            {c.customer_issues} / {c.risks}
            {c.critical_risks > 0 && (
              <span className="text-red-600 dark:text-red-400"> · {c.critical_risks} critical</span>
            )}
          </div>
        </div>
      </div>

      {silent.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowSilent((v) => !v)}
            className="text-[10px] font-mono uppercase text-muted-foreground hover:text-foreground"
          >
            {showSilent ? "Hide" : "View"} silent channels ({silent.length})
          </button>
          {showSilent && (
            <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
              {silent.map((s, i) => (
                <div key={i} className="text-[10px] text-muted-foreground leading-tight font-mono">
                  #{s.channel}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type AzureSignal = NonNullable<Props["azureReposSignal"]>;

function TrendChip({ trend, pct, delta }: { trend?: "up" | "down" | "flat"; pct?: number; delta?: number }) {
  const t = trend || "flat";
  const sym = t === "up" ? "▲" : t === "down" ? "▼" : "=";
  const cls = t === "up"
    ? "text-emerald-600 dark:text-emerald-400"
    : t === "down"
    ? "text-rose-600 dark:text-rose-400"
    : "text-muted-foreground";
  const label = pct !== undefined && Number.isFinite(pct)
    ? `${pct > 0 ? "+" : ""}${pct}%`
    : delta !== undefined
    ? `${delta > 0 ? "+" : ""}${delta}`
    : "";
  return (
    <span className={`text-[10px] font-mono tabular-nums ${cls}`}>
      {sym} {label}
    </span>
  );
}

function AzureReposSection({ signal }: { signal: AzureSignal }) {
  const [showAll, setShowAll] = useState(false);
  const wow = signal?.wow || {};
  const contributors = signal?.contributors_7d || [];
  const top = signal?.top_contributor;
  const visible = showAll ? contributors : contributors.slice(0, 8);

  const tiles: Array<{ label: string; value: number; trend?: "up" | "down" | "flat"; pct?: number; delta?: number }> = [
    { label: "Commits 7d", value: Number(signal?.commits_7d || 0), trend: wow.trend, pct: wow.commits_pct, delta: wow.commits_delta },
    { label: "Files added 7d", value: Number(signal?.files_added_7d || 0), pct: wow.files_added_pct, delta: wow.files_added_delta, trend: (wow.files_added_delta || 0) > 0 ? "up" : (wow.files_added_delta || 0) < 0 ? "down" : "flat" },
    { label: "Files removed 7d", value: Number(signal?.files_removed_7d || 0), pct: wow.files_removed_pct, delta: wow.files_removed_delta, trend: (wow.files_removed_delta || 0) > 0 ? "up" : (wow.files_removed_delta || 0) < 0 ? "down" : "flat" },
    { label: "Contributors 7d", value: Number(signal?.active_contributors_7d || 0), delta: wow.contributors_delta, trend: (wow.contributors_delta || 0) > 0 ? "up" : (wow.contributors_delta || 0) < 0 ? "down" : "flat" },
  ];

  const trendSentence = wow.trend === "up"
    ? `Activity is increasing (commits ${(wow.commits_pct ?? 0) > 0 ? "+" : ""}${wow.commits_pct ?? 0}% WoW).`
    : wow.trend === "down"
    ? `Activity is slowing (commits ${wow.commits_pct ?? 0}% WoW).`
    : "Activity is steady week over week.";

  return (
    <div className="space-y-3">
      <ExternalSignalColumn
        title="Azure Repos"
        icon={GitBranch}
        signal={signal}
        primaryMetric={{ label: "Repos", value: Number(signal?.repos_scanned || 0) }}
        secondaryMetric={{ label: "Open / Blocked", value: `${Number(signal?.open_prs || 0)} / ${Number(signal?.blocked_prs || 0)}` }}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map((m) => (
          <div key={m.label} className="rounded border border-border bg-background/60 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <div className="text-sm font-semibold tabular-nums text-foreground">{m.value.toLocaleString()}</div>
              {signal?.prev_window && <TrendChip trend={m.trend} pct={m.pct} delta={m.delta} />}
            </div>
          </div>
        ))}
      </div>

      {top && (
        <div className="rounded border border-border bg-background/60 px-3 py-2 text-xs">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-2">Top contributor</span>
          <span className="font-semibold text-foreground">{top.author}</span>
          <span className="text-muted-foreground"> — {top.commits} commits · {top.lines_changed} changes</span>
        </div>
      )}

      {contributors.length > 0 && (
        <div className="rounded border border-border bg-background/60">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Contributors (last 7d)</div>
            {contributors.length > 8 && (
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show top 8" : `Show all (${contributors.length})`}
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-1.5 font-normal">Author</th>
                  <th className="px-3 py-1.5 font-normal text-right">Commits</th>
                  <th className="px-3 py-1.5 font-normal text-right">Changes</th>
                  <th className="px-3 py-1.5 font-normal text-right">vs prev week</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.email || c.author} className="border-t border-border/60">
                    <td className="px-3 py-1.5 text-foreground">{c.author}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{c.commits}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{c.lines_changed}</td>
                    <td className="px-3 py-1.5 text-right">
                      <TrendChip trend={c.trend} delta={c.commits - c.commits_prev_7d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {signal?.prev_window && (
        <div className="text-[11px] text-muted-foreground italic">{trendSentence}</div>
      )}
    </div>
  );
}

export default function CommsPulseCard({ emailPulse, slackPulse, hubspotSignal, azureReposSignal }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Leadership status from email pulse (slack equivalent doesn't exist yet)
  const status = emailPulse?.leadership_status || [];
  const silent = status.filter((s) => s.state === "silent");
  const optedOutLeaders = status.filter((s) => s.state === "opted_out");
  const notConnected = status.filter((s) => s.state === "not_connected");
  const errored = status.filter((s) => s.state === "error");

  const legacySilent =
    status.length === 0 && emailPulse?.silent_leaders
      ? emailPulse.silent_leaders.map<LeadershipStatusEntry>((s) => ({
          leader: s.leader,
          email: "",
          state: "silent",
          reason: s.reason,
        }))
      : [];

  const hasAnyComms = !!(emailPulse?.per_mailbox || slackPulse || hubspotSignal || azureReposSignal);
  if (!hasAnyComms) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Inbox className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div className="text-xs text-muted-foreground">
            No comms pulse data in this briefing — neither email nor Slack scan returned results.
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Comms Pulse — last 24h
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <EmailColumn pulse={emailPulse} />
          <SlackColumn pulse={slackPulse} />
          {hubspotSignal && (
            <ExternalSignalColumn
              title="HubSpot"
              icon={Database}
              signal={hubspotSignal}
              primaryMetric={{ label: "Accounts", value: Number(hubspotSignal?.accounts_scanned || 0) }}
              secondaryMetric={{ label: "Stale / Risk", value: `${Number(hubspotSignal?.stale_deals || 0)} / ${Number(hubspotSignal?.at_risk_accounts || 0)}` }}
            />
          )}
          {azureReposSignal && (
            <AzureReposSection signal={azureReposSignal} />
          )}
        </div>

        {(silent.length > 0 || optedOutLeaders.length > 0 || notConnected.length > 0 || errored.length > 0 || legacySilent.length > 0) && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Leadership status (email signal)
            </div>
            <LeadershipGroup
              title="Silent"
              tone="amber"
              hint="connected & opted in, 0 sent in 24h"
              entries={silent.length > 0 ? silent : legacySilent}
            />
            <LeadershipGroup
              title="Opted out"
              tone="muted"
              hint="connected, scan disabled by user"
              entries={optedOutLeaders}
            />
            <LeadershipGroup
              title="Not connected"
              tone="muted"
              hint="Gmail not connected to Duncan"
              entries={notConnected}
            />
            {errored.length > 0 && (
              <LeadershipGroup
                title="Mailbox error"
                tone="amber"
                hint="opted in but scan failed"
                entries={errored}
              />
            )}
          </div>
        )}

        {((emailPulse?.per_mailbox && emailPulse.per_mailbox.length > 0) ||
          (slackPulse?.per_channel && slackPulse.per_channel.length > 0)) && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] font-mono uppercase text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "View"} per-source breakdown
            </Button>
            {expanded && (
              <div className="mt-2 space-y-3">
                {emailPulse?.per_mailbox && emailPulse.per_mailbox.length > 0 && (
                  <div className="rounded border border-border overflow-hidden">
                    <div className="px-2 py-1 bg-muted/50 text-[10px] font-mono uppercase tracking-wider text-foreground">
                      Per mailbox
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/30">
                        <tr className="text-left">
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Mailbox</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Status</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Scanned</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Sent</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Commits</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Risks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emailPulse.per_mailbox.map((m, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1.5 text-foreground">{m.mailbox || "—"}</td>
                            <td className="px-2 py-1.5">
                              {m.status === "ok" ? (
                                <span className="text-green-600 dark:text-green-400">ok</span>
                              ) : (
                                <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {m.status}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 tabular-nums">{m.emails_scanned}</td>
                            <td className="px-2 py-1.5 tabular-nums">{m.sent_count}</td>
                            <td className="px-2 py-1.5 tabular-nums">{m.commitments}</td>
                            <td className="px-2 py-1.5 tabular-nums">{m.risks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {slackPulse?.per_channel && slackPulse.per_channel.length > 0 && (
                  <div className="rounded border border-border overflow-hidden">
                    <div className="px-2 py-1 bg-muted/50 text-[10px] font-mono uppercase tracking-wider text-foreground">
                      Per channel
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/30">
                        <tr className="text-left">
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Channel</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Status</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Msgs</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Commits</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Esc.</th>
                          <th className="px-2 py-1.5 font-mono uppercase tracking-wider">Risks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slackPulse.per_channel.map((m, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1.5 text-foreground font-mono">#{m.channel}</td>
                            <td className="px-2 py-1.5">
                              {m.status === "ok" ? (
                                <span className="text-green-600 dark:text-green-400">ok</span>
                              ) : (
                                <span className="text-muted-foreground">{m.status_reason || m.status}</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 tabular-nums">{m.messages_scanned}</td>
                            <td className="px-2 py-1.5 tabular-nums">{m.commitments}</td>
                            <td className="px-2 py-1.5 tabular-nums">{m.escalations}</td>
                            <td className="px-2 py-1.5 tabular-nums">{m.risks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
          Privacy: only opted-in mailboxes and channels Duncan is a member of are scanned. Content is
          sent to OpenAI for one-time extraction; only the structured signals above are persisted.
        </p>
      </div>
    </TooltipProvider>
  );
}
