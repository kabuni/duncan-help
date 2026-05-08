import { useState } from "react";
import { motion } from "framer-motion";
import { FileText, CheckCircle, Clock, XCircle, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { usePurchaseOrders, type POStatus, type PurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useDepartments } from "@/hooks/useDepartments";
import { format } from "date-fns";
import PODetailModal from "./PODetailModal";

const statusConfig: Record<POStatus, { icon: any; color: string; label: string }> = {
  draft: { icon: FileText, color: "text-muted-foreground", label: "Draft" },
  pending_approval: { icon: Clock, color: "text-norman-warning", label: "Pending" },
  approved: { icon: CheckCircle, color: "text-norman-success", label: "Approved" },
  rejected: { icon: XCircle, color: "text-destructive", label: "Rejected" },
  cancelled: { icon: Ban, color: "text-muted-foreground", label: "Cancelled" },
};

export default function POList() {
  const { data: orders = [], isLoading } = usePurchaseOrders();
  const { data: departments = [] } = useDepartments();

  const getDeptName = (id: string) => departments.find(d => d.id === id)?.name ?? "—";

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading orders...</div>;
  }

  if (orders.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No purchase orders yet. Click "Request Approval" to create one.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((po, i) => {
        const cfg = statusConfig[po.status];
        const Icon = cfg.icon;
        return (
          <motion.div key={po.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <Card className="hover:border-primary/30 transition-colors">
              <CardContent className="py-4 px-5 flex items-center gap-4">
                <Icon className={`h-5 w-5 shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{po.po_number}</span>
                    <Badge variant="outline" className="text-[10px]">{po.category}</Badge>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{po.vendor_name} — {po.description}</p>
                  <p className="text-xs text-muted-foreground">{getDeptName(po.department_id)} · {format(new Date(po.created_at), "dd MMM yyyy")}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-foreground">£{Number(po.total_amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
                  <Badge variant={po.status === "approved" ? "default" : po.status === "rejected" ? "destructive" : "secondary"} className="text-[10px]">
                    {cfg.label}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
