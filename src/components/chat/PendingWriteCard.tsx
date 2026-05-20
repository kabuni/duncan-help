import { Check, X, Loader2, AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import type { PendingWriteAction } from "@/hooks/useNormanChat";
import { Button } from "@/components/ui/button";

interface Props {
  pending: PendingWriteAction;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
}

const TOOL_LABEL: Record<string, string> = {
  send_gmail_email: "Send email",
  send_slack_message: "Post to Slack",
  create_calendar_event: "Create calendar event",
  update_calendar_event: "Update calendar event",
  create_xero_invoice: "Create Xero invoice",
  approve_xero_invoice_payment: "Approve invoice payment",
  create_workstream_card: "Create workstream card",
  update_workstream_card: "Update workstream card",
  submit_google_form: "Submit Google Form",
  update_planner_event_meta: "Update planner event",
};

export default function PendingWriteCard({ pending, onConfirm, onCancel }: Props) {
  const label = TOOL_LABEL[pending.toolName] || pending.toolName;
  const isAwaiting = pending.state === "awaiting";
  const isConfirming = pending.state === "confirming";
  const isExecuted = pending.state === "executed";
  const isCancelled = pending.state === "cancelled";
  const isFailed = pending.state === "failed";

  return (
    <div className="rounded-xl border border-border bg-card/80 backdrop-blur p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center rounded-md bg-primary/10 text-primary px-2 py-0.5">
              {label}
            </span>
            {isExecuted && (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> Executed
              </span>
            )}
            {isCancelled && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Ban className="h-3 w-3" /> Cancelled
              </span>
            )}
            {isFailed && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" /> Failed
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-foreground leading-snug break-words">{pending.summary}</p>
          {isFailed && pending.error && (
            <p className="mt-1 text-xs text-destructive">{pending.error}</p>
          )}
        </div>
      </div>

      {isAwaiting && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onCancel(pending.pendingId)}>
            <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(pending.pendingId)}>
            <Check className="h-3.5 w-3.5 mr-1.5" /> Confirm &amp; run
          </Button>
        </div>
      )}
      {isConfirming && (
        <div className="mt-4 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Executing…
        </div>
      )}
    </div>
  );
}
