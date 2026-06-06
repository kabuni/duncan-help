import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";

const schema = z.object({
  school_name: z.string().trim().min(1, "School name is required").max(200),
  contact_name: z.string().trim().min(1, "Contact name is required").max(120),
  email: z.string().trim().email("Valid email required").max(255),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export default function RegisterSchool() {
  const [form, setForm] = useState({
    school_name: "",
    contact_name: "",
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
      email: parsed.data.email,
      phone: parsed.data.phone || null,
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
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-lg overflow-hidden">
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
          </div>
          <div className="text-left">
            <h1 className="text-lg font-bold tracking-tight">Duncan</h1>
            <p className="text-[10px] font-mono tracking-widest text-muted-foreground">KABUNI</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>School Registration</CardTitle>
            <CardDescription>
              Register your school's interest. Our team will be in touch shortly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="flex flex-col items-center text-center py-8 gap-3">
                <CheckCircle2 className="h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">Thank you</h2>
                <p className="text-sm text-muted-foreground">
                  We've received your registration and will be in touch soon.
                </p>
                <Button variant="outline" onClick={() => { setDone(false); setForm({ school_name: "", contact_name: "", email: "", phone: "", notes: "" }); }}>
                  Submit another
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="school_name">School name *</Label>
                  <Input id="school_name" value={form.school_name} onChange={update("school_name")} required maxLength={200} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Contact name *</Label>
                  <Input id="contact_name" value={form.contact_name} onChange={update("contact_name")} required maxLength={120} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={form.email} onChange={update("email")} required maxLength={255} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone} onChange={update("phone")} maxLength={40} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" value={form.notes} onChange={update("notes")} maxLength={2000} rows={4} />
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
