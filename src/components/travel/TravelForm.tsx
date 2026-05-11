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
import { Checkbox } from "@/components/ui/checkbox";
import { useCreateTravelRequest } from "@/hooks/useTravelRequests";
import { useProfile } from "@/hooks/useProfile";

const schema = z.object({
  traveller_name: z.string().trim().min(1, "Required").max(120),
  purpose: z.string().trim().min(3, "Required").max(500),
  destination_city: z.string().trim().min(1, "Required").max(80),
  destination_country: z.string().trim().min(1, "Required").max(80),
  depart_date: z.string().min(1, "Required"),
  return_date: z.string().min(1, "Required"),
  transport_mode: z.enum(["flight", "train", "car", "other"]),
  accommodation_needed: z.boolean().default(false),
  estimated_cost: z.coerce.number().min(0).max(1_000_000),
  currency: z.string().default("GBP"),
  notes: z.string().max(1000).optional(),
}).refine((d) => new Date(d.return_date) >= new Date(d.depart_date), {
  message: "Return date must be after depart date",
  path: ["return_date"],
});

type FormData = z.infer<typeof schema>;

export default function TravelForm({ onClose }: { onClose: () => void }) {
  const create = useCreateTravelRequest();
  const { profile } = useProfile();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      transport_mode: "flight",
      accommodation_needed: false,
      currency: "GBP",
      estimated_cost: 0,
    },
  });

  useEffect(() => {
    if (profile?.display_name && !form.getValues("traveller_name")) {
      form.setValue("traveller_name", profile.display_name);
    }
  }, [profile, form]);

  const onSubmit = async (values: FormData) => {
    setSubmitting(true);
    try {
      await create.mutateAsync(values);
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
              <FormField name="estimated_cost" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated cost (GBP)</FormLabel>
                  <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField name="accommodation_needed" control={form.control} render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="!mt-0">Accommodation needed</FormLabel>
              </FormItem>
            )} />

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
