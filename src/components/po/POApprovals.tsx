import { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Clock, CalendarClock, Receipt, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApprovals, useDecideApproval, type ApprovalRow } from "@/hooks/useApprovals";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

/**
 * Unified approvals inbox for the Authorisation Requests page.
 * Combines PO sign-offs (cost) AND Planner event sign-offs (event_date, etc.)
 * by reading from the central `approvals` table — same source as /approvals.
 */
export default function POApprovals() {
  const { data: rows = [], isLoading } = useApprovals();
  const { user } = useAuth();
  const decide = useDecideApproval();
  const navigate = useNavigate();
  const [rejectRow, setRejectRow] = useState<ApprovalRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const pending = rows.filter(
    (r) => r.status === "pending" && r.approver_user_id === user?.id
  );

  const handleReject = async () => {
    if (!rejectRow || !rejectReason.trim()) return;
    await decide.mutateAsync({ row: rejectRow, status: "rejected", note: rejectReason.trim() });
    setRejectRow(null);
    setRejectReason("");
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground italic">Loading…</p>;
  }

  if (pending.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Clock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Nothing pending your approval.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Includes Budget, Marketing & Creative, and Planner event sign-offs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {pending.map((r, i) => {
          const isEvent = r.source_table === "key_event_approvals";
          const Icon = isEvent ? CalendarClock : Receipt;
          const sourceLabel = isEvent ? "Planner Event" : "Authorisation";
          const sourceTone = isEvent
            ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30"
            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";

          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card className={cn("border-l-4", isEvent ? "border-l-sky-500" : "border-l-emerald-500")}>
                <CardContent className="py-4 px-5 flex items-center gap-4">
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={cn("text-[10px]", sourceTone)}>
                        {sourceLabel}
                      </Badge>
                      {r.due_at && (
                        <span className="text-[11px] text-muted-foreground">
                          Due {format(new Date(r.due_at), "dd MMM yyyy")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground truncate mt-1">{r.title}</p>
                    {r.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{r.summary}</p>
                    )}
                  </div>
                  {r.amount != null && Number(r.amount) > 0 && (
                    <p className="text-sm font-semibold text-foreground shrink-0">
                      £{Number(r.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                    </p>
                  )}
                  <div className="flex gap-2 shrink-0">
                    {r.link_path && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => navigate(r.link_path!)}
                        title="Open source"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-norman-success border-norman-success/30 hover:bg-norman-success/10"
                      onClick={() => decide.mutate({ row: r, status: "approved" })}
                      disabled={decide.isPending}
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => {
                        setRejectRow(r);
                        setRejectReason("");
                      }}
                      disabled={decide.isPending}
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <Dialog open={!!rejectRow} onOpenChange={() => setRejectRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject request</DialogTitle></DialogHeader>
          <Input
            placeholder="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setRejectRow(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={decide.isPending || !rejectReason.trim()}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
