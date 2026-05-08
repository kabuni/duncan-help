import { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePurchaseOrders, useApprovePO, type PurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useDepartments } from "@/hooks/useDepartments";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import PODetailModal from "./PODetailModal";

export default function POApprovals() {
  const { data: orders = [] } = usePurchaseOrders();
  const { data: departments = [] } = useDepartments();
  const { user } = useAuth();
  const approvePO = useApprovePO();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);

  const pending = orders.filter(o => {
    if (o.status !== "pending_approval") return false;
    const me = user?.id;
    if (!me) return false;
    // Primary approver still needs to sign
    if (o.approver_user_id === me && !o.approved_at) return true;
    // Secondary approver still needs to sign
    if (o.secondary_approver_user_id === me && !o.secondary_approved_at) return true;
    return false;
  });
  const getDeptName = (id: string) => departments.find(d => d.id === id)?.name ?? "—";

  const handleReject = async () => {
    if (!rejectId) return;
    await approvePO.mutateAsync({ id: rejectId, approved: false, rejection_reason: rejectReason });
    setRejectId(null);
    setRejectReason("");
  };

  if (pending.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Clock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No POs pending your approval.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {pending.map((po, i) => (
          <motion.div key={po.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <Card className="hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setSelected(po)}>
              <CardContent className="py-4 px-5 flex items-center gap-4">
                <div className="flex-1 min-w-0" onClick={() => setSelected(po)}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{po.po_number}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {po.approval_tier === "dual_exec"
                        ? (po.approved_at ? "Co-approval" : "Exec sign-off")
                        : po.approval_tier === "simon"
                        ? "Simon"
                        : po.approval_tier === "admin"
                        ? "Admin"
                        : "Dept Owner"}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{po.vendor_name} — {po.description}</p>
                  <p className="text-xs text-muted-foreground">{getDeptName(po.department_id)} · {format(new Date(po.created_at), "dd MMM yyyy")}</p>
                </div>
                <p className="text-sm font-semibold text-foreground shrink-0">
                  £{Number(po.total_amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </p>
                <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" className="gap-1 text-norman-success border-norman-success/30 hover:bg-norman-success/10"
                    onClick={() => approvePO.mutate({ id: po.id, approved: true })}
                    disabled={approvePO.isPending}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setRejectId(po.id)}
                    disabled={approvePO.isPending}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Dialog open={!!rejectId} onOpenChange={() => setRejectId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject PO</DialogTitle></DialogHeader>
          <Input placeholder="Reason for rejection" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={approvePO.isPending}>Reject</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
