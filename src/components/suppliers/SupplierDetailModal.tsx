import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Mail, Phone, ExternalLink, Globe, X } from "lucide-react";
import {
  useSupplierDetail, useUpsertSupplier, useUpsertContact, useDeleteContact,
  useLinkWorkstream, useUnlinkWorkstream, useWorkstreamCardOptions,
  type SupplierType, type ContractStatus,
} from "@/hooks/useSuppliers";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { toast } from "sonner";

interface Props {
  supplierId: string | null;
  isNew: boolean;
  open: boolean;
  onClose: () => void;
}

export default function SupplierDetailModal({ supplierId, isNew, open, onClose }: Props) {
  const { isAdmin } = useIsAdmin();
  const { data } = useSupplierDetail(isNew ? null : supplierId);
  const upsert = useUpsertSupplier();
  const upsertContact = useUpsertContact();
  const deleteContact = useDeleteContact();
  const linkWs = useLinkWorkstream();
  const unlinkWs = useUnlinkWorkstream();
  const { data: cardOptions = [] } = useWorkstreamCardOptions();

  const [form, setForm] = useState({
    name: "",
    type: "supplier" as SupplierType,
    website: "",
    logo_url: "",
    services: [] as string[],
    contract_status: "none" as ContractStatus,
    rate: "",
    currency: "GBP",
    renewal_date: "",
    notes: "",
  });
  const [serviceInput, setServiceInput] = useState("");
  const [newContact, setNewContact] = useState({ name: "", role: "", email: "", phone: "" });
  const [linkCardId, setLinkCardId] = useState<string>("");

  useEffect(() => {
    if (data?.supplier && !isNew) {
      const s = data.supplier;
      setForm({
        name: s.name,
        type: s.type as SupplierType,
        website: s.website || "",
        logo_url: s.logo_url || "",
        services: s.services || [],
        contract_status: (s.contract_status as ContractStatus) || "none",
        rate: s.rate || "",
        currency: s.currency || "GBP",
        renewal_date: s.renewal_date || "",
        notes: s.notes || "",
      });
    } else if (isNew) {
      setForm({
        name: "", type: "supplier", website: "", logo_url: "", services: [],
        contract_status: "none", rate: "", currency: "GBP", renewal_date: "", notes: "",
      });
    }
  }, [data?.supplier, isNew, supplierId]);

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    const payload: any = {
      ...(supplierId && !isNew ? { id: supplierId } : {}),
      name: form.name.trim(),
      type: form.type,
      website: form.website.trim() || null,
      logo_url: form.logo_url.trim() || null,
      services: form.services,
      contract_status: form.contract_status,
      rate: form.rate.trim() || null,
      currency: form.currency,
      renewal_date: form.renewal_date || null,
      notes: form.notes.trim() || null,
    };
    await upsert.mutateAsync(payload);
    if (isNew) onClose();
  };

  const addService = () => {
    const v = serviceInput.trim();
    if (v && !form.services.includes(v)) {
      setForm({ ...form, services: [...form.services, v] });
    }
    setServiceInput("");
  };

  const addContact = async () => {
    if (!supplierId || !newContact.name.trim()) return;
    await upsertContact.mutateAsync({
      supplier_id: supplierId,
      name: newContact.name.trim(),
      role: newContact.role.trim() || null,
      email: newContact.email.trim() || null,
      phone: newContact.phone.trim() || null,
    });
    setNewContact({ name: "", role: "", email: "", phone: "" });
  };

  const linkedIds = new Set(data?.workstreamLinks.map(l => l.workstream_card_id) || []);
  const availableCards = cardOptions.filter((c: any) => !linkedIds.has(c.id));

  const readOnly = !isAdmin;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add supplier / stakeholder" : form.name || "Supplier"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details" className="mt-2">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="contacts" disabled={isNew}>Contacts</TabsTrigger>
            <TabsTrigger value="projects" disabled={isNew}>Live projects</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Name *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={readOnly} maxLength={150} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Type</label>
                <Select value={form.type} onValueChange={(v: SupplierType) => setForm({ ...form, type: v })} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supplier">Supplier</SelectItem>
                    <SelectItem value="stakeholder">Stakeholder</SelectItem>
                    <SelectItem value="partner">Partner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Contract status</label>
                <Select value={form.contract_status} onValueChange={(v: ContractStatus) => setForm({ ...form, contract_status: v })} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Website</label>
                <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} disabled={readOnly} placeholder="https://" maxLength={500} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Logo URL</label>
                <Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} disabled={readOnly} placeholder="https://..." maxLength={500} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Rate</label>
                <Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} disabled={readOnly} placeholder="£500/day" maxLength={100} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Renewal date</label>
                <Input type="date" value={form.renewal_date} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })} disabled={readOnly} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Services offered</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.services.map(s => (
                    <Badge key={s} variant="secondary" className="gap-1">
                      {s}
                      {!readOnly && (
                        <button onClick={() => setForm({ ...form, services: form.services.filter(x => x !== s) })}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
                {!readOnly && (
                  <div className="flex gap-2">
                    <Input
                      value={serviceInput}
                      onChange={(e) => setServiceInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addService(); } }}
                      placeholder="Add a service tag..."
                      maxLength={50}
                    />
                    <Button type="button" variant="outline" onClick={addService}>Add</Button>
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Notes</label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={readOnly} maxLength={2000} rows={3} />
              </div>
            </div>
            {!readOnly && (
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={save} disabled={upsert.isPending}>
                  {isNew ? "Create" : "Save changes"}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="contacts" className="space-y-3 mt-3">
            {data?.contacts.length === 0 && (
              <p className="text-xs text-muted-foreground">No contacts yet.</p>
            )}
            <div className="space-y-2">
              {data?.contacts.map(c => (
                <div key={c.id} className="flex items-start justify-between border rounded-md p-3 bg-card">
                  <div className="text-sm">
                    <div className="font-medium">{c.name} {c.role && <span className="text-muted-foreground font-normal">— {c.role}</span>}</div>
                    {c.email && <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1"><Mail className="h-3 w-3" /><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></div>}
                    {c.phone && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</div>}
                  </div>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" onClick={() => deleteContact.mutate({ id: c.id, supplier_id: c.supplier_id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add contact</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} maxLength={100} />
                  <Input placeholder="Role" value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} maxLength={100} />
                  <Input placeholder="Email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} maxLength={255} />
                  <Input placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} maxLength={50} />
                </div>
                <Button size="sm" onClick={addContact} disabled={!newContact.name.trim()}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add contact
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects" className="space-y-3 mt-3">
            {data?.workstreamLinks.length === 0 && (
              <p className="text-xs text-muted-foreground">Not linked to any live projects yet.</p>
            )}
            <div className="space-y-2">
              {data?.workstreamLinks.map(l => (
                <div key={l.id} className="flex items-center justify-between border rounded-md p-3 bg-card">
                  <div className="text-sm">
                    <div className="font-medium">{l.card?.title || "(missing card)"}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {l.card?.status && <Badge variant="outline" className="text-[10px]">{l.card.status}</Badge>}
                      {l.card?.project_tag && <Badge variant="secondary" className="text-[10px]">{l.card.project_tag}</Badge>}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" onClick={() => unlinkWs.mutate({ id: l.id, supplier_id: l.supplier_id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Link a workstream</p>
                <div className="flex gap-2">
                  <Select value={linkCardId} onValueChange={setLinkCardId}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Choose a card..." /></SelectTrigger>
                    <SelectContent>
                      {availableCards.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={async () => {
                      if (!linkCardId || !supplierId) return;
                      await linkWs.mutateAsync({ supplier_id: supplierId, workstream_card_id: linkCardId });
                      setLinkCardId("");
                    }}
                    disabled={!linkCardId}
                  >
                    Link
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
