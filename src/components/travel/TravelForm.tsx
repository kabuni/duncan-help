import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTravelRequest } from "@/hooks/useTravelRequests";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";

const ACCOMMODATION_OPTIONS = ["hotel", "airbnb", "serviced_apartment", "company_provided", "other", "none"] as const;

const ACCOMMODATION_LABEL: Record<string, string> = {
  hotel: "Hotel",
  airbnb: "Airbnb",
  serviced_apartment: "Serviced apartment",
  company_provided: "Company provided",
  other: "Other",
  none: "None",
};

const schema = z.object({
  traveller_name: z.string().trim().min(1, "Required").max(120),
  purpose: z.string().trim().min(3, "Required").max(500),
  destination_city: z.string().trim().min(1, "Required").max(80),
  destination_country: z.string().trim().min(1, "Required").max(80),
  depart_date: z.string().min(1, "Required"),
  return_date: z.string().min(1, "Required"),
  transport_mode: z.enum(["flight", "train", "car", "other"]),
  accommodation_type: z.enum(ACCOMMODATION_OPTIONS),
  approver_user_id: z.string().optional(),
  estimated_cost: z.coerce.number().min(0).max(1_000_000),
  currency: z.string().default("GBP"),
  notes: z.string().max(1000).optional(),
}).refine((d) => new Date(d.return_date) >= new Date(d.depart_date), {
  message: "Return date must be after depart date",
  path: ["return_date"],
});

type FormData = z.infer<typeof schema>;

interface ApproverOption { user_id: string; display_name: string | null; }

export default function TravelForm({ onClose }: { onClose: () => void }) {
  const create = useCreateTravelRequest();
  const { profile } = useProfile();
  const [submitting, setSubmitting] = useState(false);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      transport_mode: "flight",
      accommodation_type: "none",
      approver_user_id: "auto",
      currency: "GBP",
      estimated_cost: 0,
    },
  });

  useEffect(() => {
    if (profile?.display_name && !form.getValues("traveller_name")) {
      form.setValue("traveller_name", profile.display_name);
    }
  }, [profile, form]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("approval_status", "approved")
        .order("display_name");
      setApprovers(((data || []).filter((p: any) => p.user_id) as ApproverOption[]));
    })();
  }, []);

  const onSubmit = async (values: FormData) => {
    setSubmitting(true);
    try {
      const approver_user_id = values.approver_user_id && values.approver_user_id !== "auto" ? values.approver_user_id : undefined;
      await create.mutateAsync({
        traveller_name: values.traveller_name,
        purpose: values.purpose,
        destination_city: values.destination_city,
        destination_country: values.destination_country,
        depart_date: values.depart_date,
        return_date: values.return_date,
        transport_mode: values.transport_mode,
        accommodation_type: values.accommodation_type,
        accommodation_needed: values.accommodation_type !== "none",
        approver_user_id,
        estimated_cost: values.estimated_cost,
        currency: values.currency,
        notes: values.notes,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Travel Request</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField name="traveller_name" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Traveller</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField name="purpose" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Purpose of trip</FormLabel>
                <FormControl><Textarea rows={2} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField name="destination_city" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="destination_country" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField name="depart_date" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Depart</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="return_date" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Return</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField name="transport_mode" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Transport</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="flight">Flight</SelectItem>
                      <SelectItem value="train">Train</SelectItem>
                      <SelectItem value="car">Car</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="accommodation_type" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Accommodation</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {ACCOMMODATION_OPTIONS.map(opt => (
                        <SelectItem key={opt} value={opt}>{ACCOMMODATION_LABEL[opt]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField name="estimated_cost" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated cost (GBP)</FormLabel>
                  <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="approver_user_id" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Approver</FormLabel>
                  <Select onValueChange={field.onChange} value={(field.value as string) || "auto"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Default approver" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="auto">Default approver</SelectItem>
                      {approvers.map(a => (
                        <SelectItem key={a.user_id} value={a.user_id}>
                          {a.display_name || "Unnamed"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField name="notes" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea rows={3} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={submitting}>Submit for approval</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
