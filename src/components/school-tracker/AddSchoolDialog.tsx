import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSchool, type SchoolTrackerStatus } from "@/hooks/useSchoolTracker";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const EMPTY = {
  name: "",
  region: "",
  status: "pending" as SchoolTrackerStatus,
  progress_pct: 0,
  student_count: 0,
  contact_name: "",
  contact_email: "",
};

export default function AddSchoolDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState(EMPTY);
  const create = useCreateSchool();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const region = form.region.trim();
    if (!name || !region) {
      toast({ title: "Missing fields", description: "Name and region are required.", variant: "destructive" });
      return;
    }
    const pct = Math.max(0, Math.min(100, Number(form.progress_pct) || 0));
    const students = Math.max(0, Number(form.student_count) || 0);
    if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email.trim())) {
      toast({ title: "Invalid email", description: "Enter a valid contact email.", variant: "destructive" });
      return;
    }
    try {
      await create.mutateAsync({
        name,
        region,
        status: form.status,
        progress_pct: pct,
        student_count: students,
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
      });
      toast({ title: "School added", description: `${name} added to the tracker.` });
      setForm(EMPTY);
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Couldn't add school",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add school</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">School name *</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region">Region *</Label>
            <Input id="region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} maxLength={120} placeholder="e.g. London, UK" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as SchoolTrackerStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="registered">Registered</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="progress">Progress (%)</Label>
              <Input id="progress" type="number" min={0} max={100} value={form.progress_pct} onChange={(e) => setForm({ ...form, progress_pct: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="students">Student count</Label>
            <Input id="students" type="number" min={0} value={form.student_count} onChange={(e) => setForm({ ...form, student_count: Number(e.target.value) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cn">Contact name</Label>
              <Input id="cn" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce">Contact email</Label>
              <Input id="ce" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} maxLength={200} />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Adding…</> : "Add school"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
