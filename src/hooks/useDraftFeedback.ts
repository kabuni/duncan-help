import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DraftOutcome = "sent_as_is" | "edited" | "discarded";

export interface DraftFeedbackInput {
  gmail_thread_id?: string;
  gmail_draft_id?: string;
  recipient_email?: string;
  original_draft: string;
  final_sent: string;
  outcome: DraftOutcome;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * Records what the user did with a Duncan-drafted reply. When outcome is
 * "edited", the diff between draft and sent is used at re-training time
 * as a high-weight correction signal.
 */
export function useLogDraftFeedback() {
  const qc = useQueryClient();
  return useMutation<void, Error, DraftFeedbackInput>({
    mutationFn: async (input) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const domain = input.recipient_email?.includes("@")
        ? input.recipient_email.split("@")[1].toLowerCase()
        : null;
      const distance = input.outcome === "edited"
        ? levenshtein(input.original_draft.slice(0, 4000), input.final_sent.slice(0, 4000))
        : (input.outcome === "sent_as_is" ? 0 : null);

      const { error } = await supabase.from("gmail_draft_feedback").insert({
        user_id: user.id,
        gmail_thread_id: input.gmail_thread_id ?? null,
        gmail_draft_id: input.gmail_draft_id ?? null,
        recipient_email: input.recipient_email?.toLowerCase() ?? null,
        recipient_domain: domain,
        original_draft: input.original_draft,
        final_sent: input.final_sent,
        outcome: input.outcome,
        edit_distance: distance,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gmail-writing-profile"] }),
  });
}
