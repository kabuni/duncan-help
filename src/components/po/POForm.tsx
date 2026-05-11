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
  { value: "creative", label: "Creative" },
  { value: "travel", label: "Travel" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "other", label: "Other" },
];

const LEADERSHIP_TITLES = [
  "Founder/CEO",
  "CEO",
  "COO & General Counsel",
  "COO",
  "CMO",
  "CPO",
  "CTO",
  "Director of Operations",
];

const isLeadership = (title: string | null | undefined) =>
  !!title && LEADERSHIP_TITLES.some(t => t.toLowerCase() === title.toLowerCase());

const schema = z.object({
  department_id: z.string().min(1, "Select a department"),
  vendor_name: z.string().trim().min(1, "Required").max(200),
  description: z.string().trim().min(1, "Required").max(1000),
  category: z.enum(["software", "hardware", "services", "marketing", "creative", "travel", "office_supplies", "other"]),
  total_amount: z.coerce.number().optional(),
  approver_user_id: z.string().optional(),
  approver_user_ids: z.array(z.string()).optional(),
  delivery_date: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

type FormData = z.infer<typeof schema>;

interface ApproverOption { user_id: string; display_name: string | null; role_title: string | null; }

export default function POForm({ onClose, kind = "budget" }: { onClose: () => void; kind?: "budget" | "creative" }) {
  const { data: departments = [] } = useDepartments();
  const createPO = useCreatePO();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [leadershipApprovers, setLeadershipApprovers] = useState<ApproverOption[]>([]);

  const isCreative = kind === "creative";
  const allowedCategories = isCreative
    ? categories.filter(c => c.value === "marketing" || c.value === "creative")
    : categories.filter(c => c.value !== "marketing" && c.value !== "creative");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, role_title")
        .eq("approval_status", "approved")
        .order("display_name");
      const all = (data || []).filter((p: any) => p.user_id) as ApproverOption[];
      setApprovers(all);
      setLeadershipApprovers(all.filter(p => isLeadership(p.role_title) || p.display_name?.toLowerCase().includes("simon wood")));
    })();
  }, []);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      total_amount: 0,
      category: isCreative ? "marketing" : "other",
      approver_user_id: "auto",
      approver_user_ids: [],
    },
  });

  const totalAmount = Number(form.watch("total_amount")) || 0;

  const onSubmit = async (values: FormData) => {
    if (!isCreative && (!values.total_amount || values.total_amount < 0.01)) {
      form.setError("total_amount", { message: "Enter an amount" });
      return;
    }
    if (isCreative && (!values.approver_user_ids || values.approver_user_ids.length === 0)) {
      form.setError("approver_user_ids", { message: "Select at least one approver" });
      return;
    }

    let attachment_path: string | undefined;

    if (file && user) {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("po-attachments").upload(path, file);
      if (!error) attachment_path = path;
    }

    const amount = isCreative ? 0 : (values.total_amount || 0);

    const approver_user_id = isCreative
      ? values.approver_user_ids?.[0]
      : (values.approver_user_id && values.approver_user_id !== "auto" ? values.approver_user_id : undefined);
    const secondary_approver_user_id = isCreative ? values.approver_user_ids?.[1] : undefined;

    await createPO.mutateAsync({
      department_id: values.department_id,
      vendor_name: values.vendor_name,
      description: values.description,
      category: values.category,
      quantity: 1,
      unit_price: amount,
      total_amount: amount,
      delivery_date: values.delivery_date,
      notes: values.notes,
      attachment_path,
      approver_user_id,
      secondary_approver_user_id,
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
          <DialogTitle>{isCreative ? "Marketing & Creative Authorisation" : "Budget Authorisation"}</DialogTitle>
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
                <FormControl><Textarea {...field} placeholder={isCreative ? "What is being signed off" : "What is this purchase for?"} rows={2} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {allowedCategories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {!isCreative && (
              <>
                <CurrencyAmountFields form={form} />

                <div className="rounded-md border border-border bg-secondary/30 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Total: £{totalAmount.toFixed(2)}</span>
                  <span className="text-xs font-mono text-muted-foreground">{tierLabel}</span>
                </div>
              </>
            )}

            {isCreative ? (
              <FormField control={form.control} name="approver_user_ids" render={({ field }) => {
                const selected: string[] = Array.isArray(field.value) ? field.value : [];
                const toggle = (id: string) => {
                  if (selected.includes(id)) {
                    field.onChange(selected.filter(x => x !== id));
                  } else if (selected.length < 2) {
                    field.onChange([...selected, id]);
                  }
                };
                return (
                  <FormItem>
                    <FormLabel>Approvers</FormLabel>
                    <div className="rounded-md border border-border divide-y divide-border max-h-56 overflow-y-auto">
                      {leadershipApprovers.length === 0 && (
                        <p className="text-xs text-muted-foreground p-3">No CEO/Director approvers available.</p>
                      )}
                      {leadershipApprovers.map(a => {
                        const checked = selected.includes(a.user_id);
                        const disabled = !checked && selected.length >= 2;
                        return (
                          <label
                            key={a.user_id}
                            className={`flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            <div className="flex flex-col">
                              <span className="text-foreground">{a.display_name || "Unnamed"}</span>
                              <span className="text-xs text-muted-foreground">{a.role_title}</span>
                            </div>
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-primary"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggle(a.user_id)}
                            />
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Select up to 2 approvers (CEO and Directors). Both must sign off when 2 are selected.
                    </p>
                    <FormMessage />
                  </FormItem>
                );
              }} />
            ) : (
              <FormField control={form.control} name="approver_user_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Approver</FormLabel>
                  <Select onValueChange={field.onChange} value={(field.value as string) || "auto"}>
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
            )}

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
