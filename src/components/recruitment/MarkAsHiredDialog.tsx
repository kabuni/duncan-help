import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, Upload, FileText, X } from "lucide-react";
import { toast } from "sonner";

interface Profile { user_id: string; display_name: string | null }

function sanitizeFileName(fileName: string) {
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const base = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const safe = base
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "")
    .toLowerCase() || "offer-letter";
  return ext ? `${safe}.${ext}` : safe;
}

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
  const [offerLetter, setOfferLetter] = useState<File | null>(null);
  const [sendSlackWelcome, setSendSlackWelcome] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPreferredName(candidate?.preferred_name || candidate?.name || "");
    setOfferLetter(null);
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
      // 1. Upload offer letter (optional but recommended)
      let offerLetterStoragePath: string | undefined;
      if (offerLetter) {
        if (offerLetter.size > 20 * 1024 * 1024) {
          throw new Error("Offer letter exceeds 20MB");
        }
        const path = `${candidate.id}/${Date.now()}_${sanitizeFileName(offerLetter.name)}`;
        const { error: upErr } = await supabase.storage
          .from("offer-letters")
          .upload(path, offerLetter, { contentType: offerLetter.type || undefined });
        if (upErr) throw new Error(`Offer letter upload failed: ${upErr.message}`);
        offerLetterStoragePath = path;
      }

      // 2. Trigger onboarding
      const { data, error } = await supabase.functions.invoke("trigger-onboarding", {
        body: {
          candidate_id: candidate.id,
          start_date: startDate,
          hiring_manager_id: hiringManagerId,
          employment_type: employmentType,
          work_location: workLocation,
          preferred_name: preferredName || undefined,
          offer_letter_storage_path: offerLetterStoragePath,
          send_slack_welcome: sendSlackWelcome,
        },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.already_exists) {
        toast.info("Onboarding already exists for this candidate.");
      } else {
        toast.success(`Onboarding launched — ${d?.tasks_created ?? 0} tasks, ${d?.calendar_events?.filter((e: any) => e.id).length ?? 0} calendar events.`);
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
            Duncan will create an onboarding workstream (with CV, JD, and offer letter attached), calendar invites, a company-signed welcome email, and a draft 30/60/90-day plan.
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

          <div className="space-y-1.5">
            <Label>Offer letter (PDF)</Label>
            {offerLetter ? (
              <div className="flex items-center gap-2 border border-border/60 rounded-md px-2 py-1.5 text-xs bg-card/50">
                <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate flex-1">{offerLetter.name}</span>
                <button
                  type="button"
                  onClick={() => { setOfferLetter(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove offer letter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 w-full border border-dashed border-border rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50"
              >
                <Upload className="h-3.5 w-3.5" /> Upload offer letter (attached to welcome email)
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => setOfferLetter(e.target.files?.[0] || null)}
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground pt-1 cursor-pointer">
            <Checkbox
              checked={sendSlackWelcome}
              onCheckedChange={(v) => setSendSlackWelcome(v === true)}
              className="mt-0.5"
            />
            <span>Post a welcome message in Slack <span className="font-medium text-foreground">#general</span> when they start.</span>
          </label>
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
