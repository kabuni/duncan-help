import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, MessageSquare, History, Pencil, ShieldCheck, Clock, XCircle, ArrowRight, Archive } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  useOnboardingPlanRevisions,
  useSubmitPlanRevision,
  useDecidePlanRevision,
  type OnboardingPlan,
  type OnboardingPlanRevision,
  type PlanRevisionStatus,
} from "@/hooks/useOnboardingPlan";

const STATUS_META: Record<PlanRevisionStatus, { label: string; tone: string; Icon: any }> = {
  pending_review:     { label: "Pending review",     tone: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400", Icon: Clock },
  approved:           { label: "Approved",           tone: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400", Icon: ShieldCheck },
  changes_requested:  { label: "Changes requested",  tone: "bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-400", Icon: MessageSquare },
  rejected:           { label: "Rejected",           tone: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle },
  superseded:         { label: "Superseded",         tone: "bg-muted text-muted-foreground border-border", Icon: Archive },
};

function StatusBadge({ status }: { status: PlanRevisionStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <Badge className={cn("border text-[10px] inline-flex items-center gap-1", meta.tone)}>
      <Icon className="h-3 w-3" /> {meta.label}
    </Badge>
  );
}

function PlanList({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

function PlanSectionView({
  title,
  section,
  changed,
}: {
  title: string;
  section: any;
  changed?: boolean;
}) {
  return (
    <Card className={cn("p-4 space-y-3", changed && "ring-2 ring-sky-500/40")}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {changed && <Badge variant="outline" className="text-[10px] border-sky-500/30 text-sky-600">Changed</Badge>}
      </div>
      <PlanList label="Learning goals" items={section?.learning_goals} />
      <PlanList label="Intros" items={section?.intros} />
      {section?.first_deliverable && (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">First deliverable</p>
          <p className="text-sm">{section.first_deliverable}</p>
        </div>
      )}
      <PlanList label="Ownership areas" items={section?.ownership_areas} />
      <PlanList label="KPIs" items={section?.kpis} />
      <PlanList label="Stakeholders" items={section?.stakeholders} />
      <PlanList label="Probation criteria" items={section?.probation_criteria} />
    </Card>
  );
}

function PlanView({ plan, changedSections }: { plan: OnboardingPlan; changedSections?: string[] }) {
  const changed = new Set(changedSections ?? []);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <PlanSectionView title="First 30 days" section={plan.days_30} changed={changed.has("days_30")} />
      <PlanSectionView title="Days 30–60"   section={plan.days_60} changed={changed.has("days_60")} />
      <PlanSectionView title="Days 60–90"   section={plan.days_90} changed={changed.has("days_90")} />
    </div>
  );
}

// Editor — expose plan as raw JSON textarea for v1 (fast + honest about shape).
function PlanEditor({
  baseline,
  candidateId,
  onboardingRunId,
  onSubmitted,
}: {
  baseline: OnboardingPlan;
  candidateId: string;
  onboardingRunId: string | null;
  onSubmitted: () => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(baseline, null, 2));
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = useSubmitPlanRevision();

  const handleSubmit = async () => {
    setError(null);
    let parsed: OnboardingPlan;
    try {
      parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("Plan must be a JSON object");
    } catch (e: any) {
      setError("Invalid JSON: " + e.message);
      return;
    }
    if (!summary.trim()) {
      setError("Change summary is required");
      return;
    }
    await submit.mutateAsync({
      candidate_id: candidateId,
      onboarding_run_id: onboardingRunId,
      plan: parsed,
      change_summary: summary.trim(),
    });
    onSubmitted();
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
          Change summary <span className="text-destructive">*</span>
        </p>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What did you change and why? (e.g. Reduced Day-30 scope after HM feedback)"
          className="min-h-16 text-sm"
        />
      </div>
      <div>
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Plan JSON</p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-96 text-xs font-mono"
          spellCheck={false}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={submit.isPending}>
          Save & submit for approval
        </Button>
      </div>
    </div>
  );
}

function ApproverActions({
  revision,
  isApprover,
}: {
  revision: OnboardingPlanRevision;
  isApprover: boolean;
}) {
  const [mode, setMode] = useState<null | "reject" | "changes">(null);
  const [note, setNote] = useState("");
  const decide = useDecidePlanRevision();

  if (revision.status !== "pending_review" && revision.status !== "changes_requested") return null;
  if (!isApprover) {
    return <p className="text-xs text-muted-foreground italic">You are not the assigned approver for this revision.</p>;
  }

  if (mode) {
    return (
      <div className="space-y-2 border-t border-border pt-3">
        <Textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={mode === "reject" ? "Reason for rejection (required)" : "What needs to change? (required)"}
          className="min-h-24 text-xs"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setMode(null); setNote(""); }}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!note.trim() || decide.isPending}
            onClick={async () => {
              await decide.mutateAsync({
                revision_id: revision.id,
                candidate_id: revision.candidate_id,
                decision: mode === "reject" ? "rejected" : "changes_requested",
                note: note.trim(),
              });
              setMode(null); setNote("");
            }}
          >
            Confirm {mode === "reject" ? "reject" : "request changes"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-border pt-3">
      <Button
        size="sm"
        className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
        disabled={decide.isPending}
        onClick={() =>
          decide.mutate({
            revision_id: revision.id,
            candidate_id: revision.candidate_id,
            decision: "approved",
          })
        }
      >
        <Check className="h-3.5 w-3.5" /> Approve
      </Button>
      <Button size="sm" variant="outline" className="gap-1" onClick={() => setMode("changes")}>
        <MessageSquare className="h-3.5 w-3.5" /> Request changes
      </Button>
      <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => setMode("reject")}>
        <X className="h-3.5 w-3.5" /> Reject
      </Button>
    </div>
  );
}

export function OnboardingPlanDialog() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const candidateId = params.get("candidate");
  const planParam = params.get("plan"); // optional — deep link to specific revision
  const open = !!candidateId && (params.get("view") === "plan" || !!planParam);

  const [tab, setTab] = useState<"current" | "history" | "edit">("current");
  useEffect(() => { if (open) setTab("current"); }, [open, candidateId]);

  const { data: revisions = [], isLoading } = useOnboardingPlanRevisions(candidateId);

  const current = useMemo<OnboardingPlanRevision | undefined>(() => {
    if (planParam) {
      const hit = revisions.find((r) => r.id === planParam);
      if (hit) return hit;
    }
    // Prefer pending → approved → latest
    return (
      revisions.find((r) => r.status === "pending_review") ||
      revisions.find((r) => r.status === "changes_requested") ||
      revisions.find((r) => r.status === "approved") ||
      revisions[0]
    );
  }, [revisions, planParam]);

  const isApprover =
    !!current &&
    !!user &&
    (current.status === "pending_review" || current.status === "changes_requested") &&
    current.approver_user_id === user.id;

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("view");
    next.delete("plan");
    setParams(next, { replace: true });
  };

  if (!candidateId) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            30/60/90 Onboarding Plan
            {current && <StatusBadge status={current.status} />}
            {current && (
              <span className="text-xs font-mono text-muted-foreground">
                v{current.revision_number} · {STATUS_META[current.status].label}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            AI drafts the plan; the assigned approver reviews and approves. Every revision is preserved.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground italic">Loading revisions…</p>
        ) : revisions.length === 0 ? (
          <Card className="border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No plan has been drafted yet. It will appear here once onboarding is triggered.
            </p>
          </Card>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col min-h-0">
            <TabsList>
              <TabsTrigger value="current">Current</TabsTrigger>
              <TabsTrigger value="history" className="gap-1">
                <History className="h-3.5 w-3.5" /> History ({revisions.length})
              </TabsTrigger>
              <TabsTrigger value="edit" className="gap-1">
                <Pencil className="h-3.5 w-3.5" /> Edit & submit
              </TabsTrigger>
            </TabsList>

            <TabsContent value="current" className="flex-1 min-h-0">
              <ScrollArea className="h-[62vh] pr-3">
                {current ? (
                  <div className="space-y-4">
                    <Card className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Authored {format(new Date(current.created_at), "d MMM yyyy · HH:mm")}
                            {" · "}
                            <span className="font-mono">{current.authored_source}</span>
                          </p>
                          {current.change_summary && (
                            <p className="text-sm mt-1">{current.change_summary}</p>
                          )}
                          {current.decision_note && (
                            <p className="text-xs italic text-muted-foreground mt-2">
                              Decision note: {current.decision_note}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={current.status} />
                      </div>
                      <ApproverActions revision={current} isApprover={isApprover} />
                    </Card>

                    <PlanView
                      plan={current.plan}
                      changedSections={current.diff_from_previous?.sections_changed}
                    />
                  </div>
                ) : null}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="history" className="flex-1 min-h-0">
              <ScrollArea className="h-[62vh] pr-3">
                <div className="space-y-2">
                  {revisions.map((r) => (
                    <Card key={r.id} className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">v{r.revision_number}</span>
                            <StatusBadge status={r.status} />
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {r.authored_source}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {format(new Date(r.created_at), "d MMM yyyy · HH:mm")}
                            {r.change_summary ? ` — ${r.change_summary}` : ""}
                          </p>
                          {r.decision_note && (
                            <p className="text-[11px] italic text-muted-foreground mt-1">
                              Note: {r.decision_note}
                            </p>
                          )}
                          {r.diff_from_previous?.sections_changed?.length ? (
                            <p className="text-[11px] text-sky-600 mt-1 flex items-center gap-1">
                              <ArrowRight className="h-3 w-3" />
                              Changed: {r.diff_from_previous.sections_changed.join(", ")}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const next = new URLSearchParams(params);
                            next.set("plan", r.id);
                            next.set("view", "plan");
                            setParams(next, { replace: true });
                            setTab("current");
                          }}
                        >
                          View
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="edit" className="flex-1 min-h-0">
              <ScrollArea className="h-[62vh] pr-3">
                <PlanEditor
                  baseline={current?.plan ?? {}}
                  candidateId={candidateId}
                  onboardingRunId={current?.onboarding_run_id ?? null}
                  onSubmitted={() => setTab("current")}
                />
                <Separator className="my-4" />
                <p className="text-[11px] text-muted-foreground">
                  Submitting creates a new revision (v{revisions.length + 1}) with status
                  <em> pending review</em>. The prior pending revision, if any, is auto-superseded.
                  Approved and rejected revisions are preserved unchanged.
                </p>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
