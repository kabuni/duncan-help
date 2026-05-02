import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";

const sanitizeFileName = (fileName: string) => {
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const base = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const safe = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "file";
  return ext ? `${safe}.${ext}` : safe;
};

const CATEGORIES = [
  "Event",
  "Holiday",
  "Marketing",
  "Launch",
  "Investor",
  "Product",
  "Operations",
  "Travel",
  "Other",
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate?: Date | null;
  onCreated: () => void;
}

export function AddEventDialog({ open, onOpenChange, defaultDate, onCreated }: Props) {
  const today = (defaultDate ?? new Date()).toISOString().slice(0, 10);
  const [draft, setDraft] = useState({
    event_name: "",
    category: "Event",
    start_date: today,
    start_time: "",
    end_date: today,
    end_time: "",
    all_day: true,
    owner: "",
    objective: "",
    location: "",
    raw_description: "",
  });
  const [saving, setSaving] = useState(false);
  const [owners, setOwners] = useState<{ user_id: string; display_name: string | null }[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("approval_status", "approved")
        .order("display_name");
      setOwners((data || []).filter((p) => p.display_name));
    })();
  }, [open]);

  function reset() {
    setDraft({
      event_name: "",
      category: "Event",
      start_date: today,
      start_time: "",
      end_date: today,
      end_time: "",
      all_day: true,
      owner: "",
      objective: "",
      location: "",
      raw_description: "",
    });
  }

  async function save() {
    if (!draft.event_name.trim()) {
      toast.error("Event name is required");
      return;
    }
    if (!draft.start_date) {
      toast.error("Start date is required");
      return;
    }
    setSaving(true);

    const startISO = draft.all_day
      ? new Date(`${draft.start_date}T00:00:00`).toISOString()
      : new Date(`${draft.start_date}T${draft.start_time || "09:00"}:00`).toISOString();
    const endISO = draft.all_day
      ? new Date(`${draft.end_date || draft.start_date}T23:59:59`).toISOString()
      : new Date(`${draft.end_date || draft.start_date}T${draft.end_time || draft.start_time || "10:00"}:00`).toISOString();

    const localId = `local:${crypto.randomUUID()}`;
    const title = `[${draft.category}] ${draft.event_name.trim()}`;

    const isComplete = !!(draft.owner.trim() && draft.objective.trim());
    const missing: string[] = [];
    if (!draft.owner.trim()) missing.push("owner");
    if (!draft.objective.trim()) missing.push("objective");

    const { error } = await supabase.from("key_events" as any).insert({
      google_event_id: localId,
      calendar_id: "local",
      title,
      event_name: draft.event_name.trim(),
      category: draft.category,
      start_at: startISO,
      end_at: endISO,
      all_day: draft.all_day,
      location: draft.location.trim() || null,
      raw_description: draft.raw_description.trim() || null,
      owner: draft.owner.trim() || null,
      objective: draft.objective.trim() || null,
      missing_fields: missing,
      is_complete: isComplete,
      risk_level: isComplete ? "green" : "amber",
      risk_reason: isComplete ? null : "Missing owner or objective",
      linked_goal_ids: [],
      linked_docs: [],
      attendees: [],
      deleted_in_google: false,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Event added to diary");
    reset();
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add diary entry</DialogTitle>
          <DialogDescription>
            Create an event, holiday, marketing milestone, or other key date directly in Duncan's diary.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="ev-name">Name *</Label>
            <Input
              id="ev-name"
              value={draft.event_name}
              onChange={(e) => setDraft({ ...draft, event_name: e.target.value })}
              placeholder="e.g. Diwali, Website launch, Investor demo"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Owner</Label>
            <Select value={draft.owner} onValueChange={(v) => setDraft({ ...draft, owner: v })}>
              <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
              <SelectContent>
                {owners.map((o) => (
                  <SelectItem key={o.user_id} value={o.display_name as string}>
                    {o.display_name}
                  </SelectItem>
                ))}
                {owners.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No team members</div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 flex items-center gap-2 pt-1">
            <Checkbox
              id="ev-allday"
              checked={draft.all_day}
              onCheckedChange={(v) => setDraft({ ...draft, all_day: !!v })}
            />
            <Label htmlFor="ev-allday" className="cursor-pointer text-sm font-normal">All day</Label>
          </div>

          <div className="space-y-1.5">
            <Label>Start date</Label>
            <Input
              type="date"
              value={draft.start_date}
              onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End date</Label>
            <Input
              type="date"
              value={draft.end_date}
              onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
            />
          </div>

          {!draft.all_day && (
            <>
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input
                  type="time"
                  value={draft.start_time}
                  onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End time</Label>
                <Input
                  type="time"
                  value={draft.end_time}
                  onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="ev-loc">Location</Label>
            <Input
              id="ev-loc"
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="Optional"
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="ev-obj">Objective</Label>
            <Input
              id="ev-obj"
              value={draft.objective}
              onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
              placeholder="What outcome does this drive?"
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="ev-desc">Notes</Label>
            <Textarea
              id="ev-desc"
              value={draft.raw_description}
              onChange={(e) => setDraft({ ...draft, raw_description: e.target.value })}
              rows={3}
              placeholder="Optional context"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !draft.event_name.trim()}>
            {saving ? "Saving…" : "Add to diary"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
