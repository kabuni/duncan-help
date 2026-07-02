import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import type { Meeting } from "@/data/meetings";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (m: Meeting) => void;
  regions: string[];
}

const EMPTY = {
  name: "",
  school: "",
  location: "",
  region: "North",
  date: "",
  time: "",
  confirmed: "Confirmed",
  num_schools: "",
  note: "",
};

const REGIONS_DEFAULT = ["North", "South", "East", "West", "Central"];

function sheetFromDate(d: string): string {
  if (!d) return "Custom";
  try {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } catch {
    return "Custom";
  }
}

function dayFromDate(d: string): string | null {
  if (!d) return null;
  try {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });
  } catch {
    return null;
  }
}

export default function AddMeetingDialog({ open, onOpenChange, onAdd, regions }: Props) {
  const [form, setForm] = useState(EMPTY);
  const regionOpts = Array.from(new Set([...REGIONS_DEFAULT, ...regions])).filter(Boolean);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.school.trim()) {
      toast({ title: "Missing fields", description: "Contact and School are required.", variant: "destructive" });
      return;
    }
    const num = form.num_schools.trim() === "" ? null : Number(form.num_schools);
    const meeting: Meeting = {
      sheet: sheetFromDate(form.date),
      name: form.name.trim(),
      school: form.school.trim(),
      location: form.location.trim(),
      region: form.region,
      date: form.date || null,
      date_raw: null,
      day: dayFromDate(form.date),
      time: form.time || null,
      confirmed: form.confirmed,
      num_schools: num !== null && !Number.isNaN(num) ? num : null,
      note: form.note.trim() || null,
    };
    onAdd(meeting);
    toast({ title: "Meeting added", description: `${meeting.school} added to the dashboard.` });
    setForm(EMPTY);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader><DialogTitle>Add school meeting</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Contact *</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school">School *</Label>
              <Input id="school" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} maxLength={200} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {regionOpts.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">Time</Label>
              <Input id="time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.confirmed} onValueChange={(v) => setForm({ ...form, confirmed: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Confirmed">Confirmed</SelectItem>
                  <SelectItem value="Tentative">Tentative</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="num">Schools (potential reach)</Label>
            <Input id="num" type="number" min={0} value={form.num_schools} onChange={(e) => setForm({ ...form, num_schools: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={2000} />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Add meeting</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
