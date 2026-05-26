import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdatePO, useCancelPO, useApprovePO, type PurchaseOrder, type POCategory } from "@/hooks/usePurchaseOrders";
import { useDepartments } from "@/hooks/useDepartments";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { format } from "date-fns";
import { Pencil, X, Check, Ban } from "lucide-react";

const categories: { value: POCategory; label: string }[] = [
  { value: "events", label: "Events" },
  { value: "marketing", label: "Marketing" },
  { value: "social", label: "Social" },
  { value: "creative", label: "Creative" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "other", label: "Other" },
];

interface Props {
  po: PurchaseOrder;
  onClose: () => void;
}

export default function PODetailModal({ po, onClose }: Props) {
  const { data: departments = [] } = useDepartments();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const updatePO = useUpdatePO();
  const cancelPO = useCancelPO();
  const approvePO = useApprovePO();

  const isRequester = po.requester_id === user?.id;
  const isApprover =
    po.approver_user_id === user?.id || po.secondary_approver_user_id === user?.id;
  const canEdit = (isRequester || isAdmin) && (po.status === "pending_approval" || po.status === "draft");
  const canCancel = (isRequester || isAdmin) && po.status === "pending_approval";
  const canApprove =
    po.status === "pending_approval" &&
    ((po.approver_user_id === user?.id && !po.approved_at) ||
      (po.secondary_approver_user_id === user?.id && !po.secondary_approved_at));

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    department_id: po.department_id,
    vendor_name: po.vendor_name,
    description: po.description,
    category: po.category,
    quantity: po.quantity,
    unit_price: po.unit_price,
    delivery_date: po.delivery_date ?? "",
    notes: po.notes ?? "",
  });
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    setForm({
      department_id: po.department_id,
      vendor_name: po.vendor_name,
      description: po.description,
      category: po.category,
      quantity: po.quantity,
      unit_price: po.unit_price,
      delivery_date: po.delivery_date ?? "",
      notes: po.notes ?? "",
    });
  }, [po]);

  const total = (Number(form.quantity) || 0) * (Number(form.unit_price) || 0);
  const deptName = departments.find((d) => d.id === po.department_id)?.name ?? "—";

  const handleSave = async () => {
    await updatePO.mutateAsync({
      id: po.id,
      department_id: form.department_id,
      vendor_name: form.vendor_name.trim(),
      description: form.description.trim(),
      category: form.category,
      quantity: Number(form.quantity),
      unit_price: Number(form.unit_price),
      total_amount: total,
      delivery_date: form.delivery_date || null,
      notes: form.notes || null,
    });
    setEditing(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{po.po_number}</span>
              <Badge variant="outline" className="text-[10px] uppercase">{po.status.replace("_", " ")}</Badge>
            </DialogTitle>
            {canEdit && !editing && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        {!editing ? (
          <div className="space-y-4 text-sm">
            <DetailRow label="Vendor" value={po.vendor_name} />
            <DetailRow label="Description" value={po.description} />
            <div className="grid grid-cols-2 gap-4">
              <DetailRow label="Department" value={deptName} />
              <DetailRow label="Category" value={po.category} />
              <DetailRow label="Quantity" value={String(po.quantity)} />
              <DetailRow label="Unit Price" value={`£${Number(po.unit_price).toFixed(2)}`} />
              <DetailRow
                label="Total"
                value={`£${Number(po.total_amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`}
              />
              <DetailRow
                label="Delivery"
                value={po.delivery_date ? format(new Date(po.delivery_date), "dd MMM yyyy") : "—"}
              />
              <DetailRow label="Tier" value={po.approval_tier ?? "—"} />
              <DetailRow label="Created" value={format(new Date(po.created_at), "dd MMM yyyy HH:mm")} />
            </div>
            {po.notes && <DetailRow label="Notes" value={po.notes} />}
            {po.rejection_reason && (
              <DetailRow label="Rejection reason" value={po.rejection_reason} />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Department">
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Vendor">
              <Input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            </Field>
            <Field label="Description">
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Category">
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as POCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <Input type="number" min={1} value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
              </Field>
              <Field label="Unit Price (£)">
                <Input type="number" step="0.01" min={0} value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="rounded-md border border-border bg-secondary/30 px-4 py-2 text-sm">
              Total: <span className="font-semibold">£{total.toFixed(2)}</span>
            </div>
            <Field label="Delivery date">
              <Input type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-border">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={updatePO.isPending}>
                {updatePO.isPending ? "Saving..." : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              {canCancel && (
                <Button variant="outline" className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={async () => { await cancelPO.mutateAsync(po.id); onClose(); }}
                  disabled={cancelPO.isPending}>
                  <Ban className="h-3.5 w-3.5" /> Delete request
                </Button>
              )}
              {canApprove && !rejecting && (
                <>
                  <Button variant="outline" className="gap-1 text-norman-success border-norman-success/30 hover:bg-norman-success/10"
                    onClick={async () => { await approvePO.mutateAsync({ id: po.id, approved: true }); onClose(); }}
                    disabled={approvePO.isPending}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button variant="outline" className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setRejecting(true)}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                </>
              )}
              {canApprove && rejecting && (
                <div className="flex w-full gap-2">
                  <Input placeholder="Reason for rejection" value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)} className="flex-1" autoFocus />
                  <Button variant="outline" onClick={() => { setRejecting(false); setRejectReason(""); }}>Cancel</Button>
                  <Button variant="destructive" disabled={!rejectReason.trim() || approvePO.isPending}
                    onClick={async () => {
                      await approvePO.mutateAsync({ id: po.id, approved: false, rejection_reason: rejectReason.trim() });
                      onClose();
                    }}>
                    Confirm reject
                  </Button>
                </div>
              )}
              {!canCancel && !canApprove && (
                <Button variant="outline" onClick={onClose}>Close</Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-foreground whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
