import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreatePO, type POCategory } from "@/hooks/usePurchaseOrders";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const categories: { value: POCategory; label: string }[] = [
  { value: "software", label: "Software" },
  { value: "hardware", label: "Hardware" },
  { value: "services", label: "Services" },
  { value: "marketing", label: "Marketing" },
  { value: "travel", label: "Travel" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "other", label: "Other" },
];

const schema = z.object({
  department_id: z.string().min(1, "Select a department"),
  vendor_name: z.string().trim().min(1, "Required").max(200),
  description: z.string().trim().min(1, "Required").max(1000),
  category: z.enum(["software", "hardware", "services", "marketing", "travel", "office_supplies", "other"]),
  quantity: z.coerce.number().int().min(1),
  unit_price: z.coerce.number().min(0.01),
  approver_user_id: z.string().optional(),
  delivery_date: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

type FormData = z.infer<typeof schema>;

interface ApproverOption { user_id: string; display_name: string | null; }

export default function POForm({ onClose }: { onClose: () => void }) {
  const { data: departments = [] } = useDepartments();
  const createPO = useCreatePO();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("approval_status", "approved")
        .order("display_name");
      setApprovers((data || []).filter((p: any) => p.user_id) as ApproverOption[]);
    })();
  }, []);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { quantity: 1, category: "other", approver_user_id: "auto" },
  });

  const quantity = form.watch("quantity") ?? 1;
  const unitPrice = form.watch("unit_price") ?? 0;
  const totalAmount = quantity * unitPrice;

  const onSubmit = async (values: FormData) => {
    let attachment_path: string | undefined;

    if (file && user) {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("po-attachments").upload(path, file);
      if (!error) attachment_path = path;
    }

    await createPO.mutateAsync({
      department_id: values.department_id,
      vendor_name: values.vendor_name,
      description: values.description,
      category: values.category,
      quantity: values.quantity,
      unit_price: values.unit_price,
      total_amount: totalAmount,
      delivery_date: values.delivery_date,
      notes: values.notes,
      attachment_path,
      approver_user_id:
        values.approver_user_id && values.approver_user_id !== "auto"
          ? values.approver_user_id
          : undefined,
    });
    onClose();
  };

  const tierLabel =
    totalAmount < 500 ? "Auto-approved" :
    totalAmount <= 5000 ? "Simon Wood approval" :
    "Nimesh + Patrick (dual sign-off)";

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Approval</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="department_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Department</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="vendor_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor Name</FormLabel>
                <FormControl><Input {...field} placeholder="e.g. Adobe Inc." /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Textarea {...field} placeholder="What is this purchase for?" rows={2} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="quantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl><Input type="number" min={1} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="unit_price" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit Price (£)</FormLabel>
                  <FormControl><Input type="number" step="0.01" min={0.01} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="rounded-md border border-border bg-secondary/30 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Total: £{totalAmount.toFixed(2)}</span>
              <span className="text-xs font-mono text-muted-foreground">{tierLabel}</span>
            </div>

            <FormField control={form.control} name="approver_user_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Approver</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "auto"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Auto-route by amount" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="auto">Auto-route by amount (default)</SelectItem>
                    {approvers.map(a => (
                      <SelectItem key={a.user_id} value={a.user_id}>
                        {a.display_name || "Unnamed"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Nominate a specific approver, or leave on auto-route to use the standard tier rules.
                </p>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="delivery_date" render={({ field }) => (
              <FormItem>
                <FormLabel>Expected Delivery Date</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div>
              <label className="text-sm font-medium text-foreground">Attachment</label>
              <Input type="file" className="mt-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} placeholder="Additional notes..." rows={2} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createPO.isPending}>
                {createPO.isPending ? "Submitting..." : "Request Approval"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
