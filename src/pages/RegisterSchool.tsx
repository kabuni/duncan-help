import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";

const ROLES = ["Owner", "Principal", "Educator"] as const;

const schema = z.object({
  school_name: z.string().trim().min(1, "School name is required").max(200),
  contact_name: z.string().trim().min(1, "Contact name is required").max(120),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Please select a role" }) }),
  number_of_schools: z.coerce.number().int().min(1, "Must be at least 1").max(100000),
  email: z.string().trim().email("Valid email required").max(255),
  phone: z.string().trim().min(1, "Phone number is required").max(40),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export default function RegisterSchool() {
  const [form, setForm] = useState({
    school_name: "",
    contact_name: "",
    role: "" as typeof ROLES[number] | "",
    number_of_schools: "",
    email: "",
    phone: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("school_registrations").insert({
      school_name: parsed.data.school_name,
      contact_name: parsed.data.contact_name,
      role: parsed.data.role,
      number_of_schools: parsed.data.number_of_schools,
      email: parsed.data.email,
      phone: parsed.data.phone,
      notes: parsed.data.notes || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Could not submit registration. Please try again.");
      return;
    }
    setDone(true);
  };

  return (
    <main className="min-h-dvh bg-background flex items-start sm:items-center justify-center px-4 py-6 sm:py-10">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-3 mb-5 sm:mb-6">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg overflow-hidden shrink-0">
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
          </div>
          <div className="text-left">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">Duncan</h1>
            <p className="text-[10px] font-mono tracking-widest text-muted-foreground">KABUNI</p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="px-5 py-5 sm:px-6 sm:py-6">
            <CardTitle className="text-lg sm:text-xl">School Registration</CardTitle>
            <CardDescription className="text-sm">
              Register your school's interest. Our team will be in touch shortly.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-6 sm:px-6">
            {done ? (
              <div className="flex flex-col items-center text-center py-6 sm:py-8 gap-3">
                <CheckCircle2 className="h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">Thank you</h2>
                <p className="text-sm text-muted-foreground">
                  We've received your registration and will be in touch soon.
                </p>
                <Button variant="outline" onClick={() => { setDone(false); setForm({ school_name: "", contact_name: "", role: "", number_of_schools: "", email: "", phone: "", notes: "" }); }}>
                  Submit another
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="school_name">School name *</Label>
                  <Input id="school_name" value={form.school_name} onChange={update("school_name")} required maxLength={200} className="text-base" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Contact name *</Label>
                  <Input id="contact_name" value={form.contact_name} onChange={update("contact_name")} required maxLength={120} className="text-base" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="role">Role *</Label>
                    <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as typeof ROLES[number] }))}>
                      <SelectTrigger id="role" className="text-base">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="number_of_schools">Number of schools *</Label>
                    <Input
                      id="number_of_schools"
                      type="number"
                      min={1}
                      value={form.number_of_schools}
                      onChange={update("number_of_schools")}
                      required
                      className="text-base"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={form.email} onChange={update("email")} required maxLength={255} className="text-base" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone *</Label>
                  <Input id="phone" type="tel" value={form.phone} onChange={update("phone")} required maxLength={40} className="text-base" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" value={form.notes} onChange={update("notes")} maxLength={2000} rows={3} className="text-base resize-y min-h-[80px]" />
                </div>
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</> : "Submit registration"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
