import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type PlanRevisionStatus =
  | "pending_review"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "superseded";

export type PlanAuthoredSource = "ai_draft" | "ai_draft_backfill" | "human_edit";

export interface PlanSection {
  learning_goals?: string[];
  intros?: string[];
  first_deliverable?: string;
  ownership_areas?: string[];
  kpis?: string[];
  stakeholders?: string[];
  probation_criteria?: string[];
}

export interface OnboardingPlan {
  days_30?: PlanSection;
  days_60?: PlanSection;
  days_90?: PlanSection;
}

export interface OnboardingPlanRevision {
  id: string;
  candidate_id: string;
  onboarding_run_id: string | null;
  revision_number: number;
  plan: OnboardingPlan;
  status: PlanRevisionStatus;
  authored_by: string | null;
  authored_source: PlanAuthoredSource;
  change_summary: string | null;
  diff_from_previous: {
    previous_plan?: OnboardingPlan;
    sections_changed?: string[];
  } | null;
  approver_user_id: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useOnboardingPlanRevisions(candidateId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding-plan-revisions", candidateId],
    enabled: !!candidateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_plan_revisions" as any)
        .select("*")
        .eq("candidate_id", candidateId!)
        .order("revision_number", { ascending: false });
      if (error) throw error;
      return (data as unknown as OnboardingPlanRevision[]) || [];
    },
  });
}

export function useSubmitPlanRevision() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      candidate_id: string;
      onboarding_run_id?: string | null;
      plan: OnboardingPlan;
      change_summary: string;
    }) => {
      const { data, error } = await supabase
        .from("onboarding_plan_revisions" as any)
        .insert({
          candidate_id: input.candidate_id,
          onboarding_run_id: input.onboarding_run_id ?? null,
          plan: input.plan,
          status: "pending_review",
          authored_by: user?.id ?? null,
          authored_source: "human_edit",
          change_summary: input.change_summary,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as OnboardingPlanRevision;
    },
    onSuccess: (rev) => {
      qc.invalidateQueries({ queryKey: ["onboarding-plan-revisions", rev.candidate_id] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approvals-count"] });
      toast.success(`Revision v${rev.revision_number} submitted for approval`);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to submit revision"),
  });
}

export function useDecidePlanRevision() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      revision_id: string;
      candidate_id: string;
      decision: "approved" | "rejected" | "changes_requested";
      note?: string;
    }) => {
      const patch: Record<string, unknown> = {
        status: input.decision,
        decision_note: input.note ?? null,
        approver_user_id: user?.id ?? null,
      };
      // Terminal decisions require decided_at (enforced by CHECK constraint).
      // 'changes_requested' is non-terminal, so decided_at stays null.
      if (input.decision === "approved" || input.decision === "rejected") {
        patch.decided_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("onboarding_plan_revisions" as any)
        .update(patch)
        .eq("id", input.revision_id);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["onboarding-plan-revisions", vars.candidate_id] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approvals-count"] });
      const label =
        vars.decision === "approved" ? "Plan approved" :
        vars.decision === "rejected" ? "Plan rejected" :
        "Changes requested";
      toast.success(label);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to record decision"),
  });
}
