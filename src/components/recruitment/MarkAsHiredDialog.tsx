import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Profile { user_id: string; display_name: string | null }

export function MarkAsHiredDialog({
  candidate,
  open,
  onOpenChange,
  onCompleted,
}: {
  candidate: { id: string; name: string; email: string | null; preferred_name?: string | null } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCompleted?: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [hiringManagerId, setHiringManagerId] = useState<string>("");
  const [employmentType, setEmploymentType] = useState<string>("full_time");
  const [workLocation, setWorkLocation] = useState<string>("hybrid");
  const [preferredName, setPreferredName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreferredName(candidate?.preferred_name || candidate?.name || "");
    supabase
      .from("profiles")
      .select("user_id, display_name")
      .order("display_name", { ascending: true })
      .then(({ data }) => {
        setProfiles(((data as any[]) || []).filter((p) => p.user_id) as Profile[]);
        supabase.auth.getUser().then(({ data: u }) => {
          if (u.user?.id) setHiringManagerId(u.user.id);
        });
      });
  }, [open, candidate]);

  const handleSubmit = async () => {
    if (!candidate) return;
    if (!startDate || !hiringManagerId) {
      toast.error("Start date and hiring manager are required");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("trigger-onboarding", {
        body: {
          candidate_id: candidate.id,
          start_date: startDate,
          hiring_manager_id: hiringManagerId,
          employment_type: employmentType,
          work_location: workLocation,
          preferred_name: preferredName || undefined,
        },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.already_exists) {
        toast.info("Onboarding already exists for this candidate.");
      } else {
        toast.success(`Onboarding launched — ${d?.tasks_created ?? 0} tasks created, ${d?.calendar_events?.filter((e: any) => e.id).length ?? 0} calendar events.`);
      }
      onCompleted?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Failed to launch onboarding: ${err.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Mark {candidate?.name} as Hired</DialogTitle>
          <DialogDescription>
            Duncan will create an onboarding workstream, calendar invites, welcome email, and a draft 30/60/90-day plan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="preferred_name">Preferred name</Label>
            <Input id="preferred_name" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="start_date">Start date</Label>
            <Input id="start_date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Hiring manager</Label>
            <Select value={hiringManagerId} onValueChange={setHiringManagerId}>
              <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.display_name || p.user_id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Employment type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full-time</SelectItem>
                  <SelectItem value="part_time">Part-time</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Work location</Label>
              <Select value={workLocation} onValueChange={setWorkLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="remote">Remote</SelectItem>
                  <SelectItem value="office">Office</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Launching…</> : "Launch Onboarding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
