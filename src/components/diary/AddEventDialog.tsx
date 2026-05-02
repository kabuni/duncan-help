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
import { Paperclip, X, Plus, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TimezonePicker, zonedDateTimeToISO } from "./TimezonePicker";

const DEFAULT_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"; } catch { return "Europe/London"; }
})();

const APPROVAL_TYPES = [
  "Design",
  "Legal",
  "Finance",
  "Marketing",
  "Operations",
  "Product",
  "Launch",
  "Investor",
  "Travel",
  "Releases",
  "Event",
  "Holiday",
  "Other",
];

interface DraftApproval {
  approval_type: string;
  label: string;
  approver_profile_id: string | null;
}

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
  "Releases",
  "Other",
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate?: Date | null;
  onCreated: () => void;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Returns "HH:mm" one hour after the given "HH:mm" string. Wraps past midnight to "23:59".
function addOneHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const total = h * 60 + m + 60;
  if (total >= 24 * 60) return "23:59";
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export function AddEventDialog({ open, onOpenChange, defaultDate, onCreated }: Props) {
  const initial = toLocalDateStr(defaultDate ?? new Date());
  const [draft, setDraft] = useState({
    event_name: "",
    category: "Event",
    start_date: initial,
    start_time: "",
    end_date: initial,
    end_time: "",
    all_day: true,
    owner: "",
    location: "",
    raw_description: "",
    start_tz: DEFAULT_TZ,
  });
  const [saving, setSaving] = useState(false);
  const [owners, setOwners] = useState<{ user_id: string; display_name: string | null; profile_id?: string }[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; display_name: string | null }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [approvals, setApprovals] = useState<DraftApproval[]>([]);
  const [appType, setAppType] = useState("Design");
  const [appLabel, setAppLabel] = useState("");
  const [appApprover, setAppApprover] = useState("none");
  const [personalCalConnected, setPersonalCalConnected] = useState(false);
  const [syncToPersonal, setSyncToPersonal] = useState(false);

  // Re-seed start/end dates whenever the dialog re-opens with a (possibly new) default date.
  useEffect(() => {
    if (!open) return;
    const seed = toLocalDateStr(defaultDate ?? new Date());
    setDraft((d) => ({ ...d, start_date: seed, end_date: seed }));
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const [{ data }, calRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, user_id, display_name")
          .eq("approval_status", "approved")
          .order("display_name"),
        uid
          ? supabase
              .from("google_calendar_tokens")
              .select("user_id")
              .eq("user_id", uid)
              .maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);
      const list = (data || []).filter((p) => p.display_name);
      setOwners(list as any);
      setProfiles(list.map((p: any) => ({ id: p.id, display_name: p.display_name })));
      setPersonalCalConnected(!!(calRes as any)?.data);

      // Default the owner to the current user (they can change it).
      const me = list.find((p: any) => p.user_id === uid);
      if (me?.display_name) {
        setDraft((d) => (d.owner ? d : { ...d, owner: me.display_name as string }));
      }
    })();
  }, [open]);


  function reset() {
    const seed = toLocalDateStr(defaultDate ?? new Date());
    setDraft({
      event_name: "",
      category: "Event",
      start_date: seed,
      start_time: "",
      end_date: seed,
      end_time: "",
      all_day: true,
      owner: "",
      location: "",
      raw_description: "",
      start_tz: DEFAULT_TZ,
    });
    setFiles([]);
    setApprovals([]);
    setAppType("Design");
    setAppLabel("");
    setAppApprover("none");
    setSyncToPersonal(false);
  }

  async function uploadFiles(eventId: string, userId: string) {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 20MB`);
        continue;
      }
      const path = `${eventId}/${Date.now()}_${sanitizeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from("key-event-attachments")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) {
        toast.error(`Upload failed: ${file.name}`);
        continue;
      }
      await supabase.from("key_event_attachments" as any).insert({
        event_id: eventId,
        uploaded_by: userId,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
      });
    }
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
    const effectiveEndDate = draft.end_date || draft.start_date;
    if (effectiveEndDate < draft.start_date) {
      toast.error("End date must be on or after the start date");
      return;
    }
    if (!draft.owner.trim()) {
      toast.error("Owner is required — every event needs an accountable owner");
      return;
    }
    setSaving(true);

    const tz = draft.start_tz || DEFAULT_TZ;
    const startISO = draft.all_day
      ? zonedDateTimeToISO(draft.start_date, "00:00", tz)
      : zonedDateTimeToISO(draft.start_date, draft.start_time || "09:00", tz);
    const endISO = draft.all_day
      ? zonedDateTimeToISO(effectiveEndDate, "23:59", tz)
      : zonedDateTimeToISO(effectiveEndDate, draft.end_time || draft.start_time || "10:00", tz);

    if (new Date(endISO) <= new Date(startISO)) {
      setSaving(false);
      toast.error("End must be after the start");
      return;
    }

    const localId = `local:${crypto.randomUUID()}`;
    const title = `[${draft.category}] ${draft.event_name.trim()}`;

    const isComplete = !!draft.owner.trim();
    const missing: string[] = [];
    if (!draft.owner.trim()) missing.push("owner");

    const { data: { user: authUser } } = await supabase.auth.getUser();

    const { data: inserted, error } = await supabase
      .from("key_events" as any)
      .insert({
        google_event_id: localId,
        calendar_id: "local",
        title,
        event_name: draft.event_name.trim(),
        category: draft.category,
        start_at: startISO,
        end_at: endISO,
        all_day: draft.all_day,
        start_tz: draft.start_tz || DEFAULT_TZ,
        location: draft.location.trim() || null,
        raw_description: draft.raw_description.trim() || null,
        owner: draft.owner.trim() || null,
        missing_fields: missing,
        is_complete: isComplete,
        risk_level: isComplete ? "green" : "amber",
        risk_reason: isComplete ? null : "Missing owner",
        linked_goal_ids: [],
        linked_docs: [],
        attendees: [],
        deleted_in_google: false,
        created_by: authUser?.id ?? null,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      setSaving(false);
      toast.error(error?.message || "Could not save event");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;

    if (files.length > 0 && uid) {
      await uploadFiles((inserted as any).id, uid);
    }

    if (approvals.length > 0 && uid) {
      const { data: insertedApprovals } = await supabase
        .from("key_event_approvals" as any)
        .insert(
          approvals.map((a) => ({
            event_id: (inserted as any).id,
            approval_type: a.approval_type,
            label: a.label.trim() || null,
            approver_profile_id: a.approver_profile_id,
            requested_by: uid,
          })),
        )
        .select("id");

      // Fire-and-forget Slack DMs to each assigned approver
      const approvalRows = (insertedApprovals as unknown as { id: string }[] | null) || [];
      for (const row of approvalRows) {
        supabase.functions
          .invoke("notify-event-approval", {
            body: { approval_id: row.id, kind: "requested" },
          })
          .catch((err) => console.warn("notify-event-approval failed:", err));
      }
    }

    let personalSyncMsg: string | null = null;
    if (syncToPersonal && personalCalConnected) {
      const { error: syncErr } = await supabase.functions.invoke(
        "add-event-to-personal-calendar",
        {
          body: {
            event_name: draft.event_name.trim(),
            category: draft.category,
            start_at: startISO,
            end_at: endISO,
            all_day: draft.all_day,
            location: draft.location.trim() || null,
            notes: draft.raw_description.trim() || null,
          },
        },
      );
      if (syncErr) {
        personalSyncMsg = `Saved to diary, but personal calendar sync failed: ${syncErr.message}`;
      }
    }

    setSaving(false);
    if (personalSyncMsg) {
      toast.error(personalSyncMsg);
    } else if (syncToPersonal && personalCalConnected) {
      toast.success("Event added to diary and your personal calendar");
    } else {
      toast.success("Event added to diary");
    }
    reset();
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl max-h-[90dvh] overflow-y-auto">
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
            <Label>Owner *</Label>
            <Select value={draft.owner} onValueChange={(v) => setDraft({ ...draft, owner: v })}>
              <SelectTrigger><SelectValue placeholder="Select owner (required)" /></SelectTrigger>
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

          <div className="col-span-2 space-y-1.5">
            <Label>Time zone</Label>
            <TimezonePicker
              value={draft.start_tz}
              onChange={(tz) => setDraft({ ...draft, start_tz: tz })}
            />
            <p className="text-[11px] text-muted-foreground">Times you enter below are interpreted in this zone.</p>
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
              onChange={(e) => {
                const newStart = e.target.value;
                setDraft((d) => ({
                  ...d,
                  start_date: newStart,
                  // Keep end_date >= start_date so we never send Google an inverted range
                  end_date: !d.end_date || d.end_date < newStart ? newStart : d.end_date,
                }));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End date</Label>
            <Input
              type="date"
              value={draft.end_date}
              min={draft.start_date}
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

          <div className="col-span-2 flex items-start gap-2 pt-1 border-t border-border mt-1">
            <Checkbox
              id="ev-sync-personal"
              checked={syncToPersonal}
              disabled={!personalCalConnected}
              onCheckedChange={(v) => setSyncToPersonal(!!v)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <Label
                htmlFor="ev-sync-personal"
                className={`cursor-pointer text-sm font-normal ${!personalCalConnected ? "text-muted-foreground" : ""}`}
              >
                Also add to my personal Google Calendar
              </Label>
              {!personalCalConnected && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect your Google Calendar in Settings → Integrations to enable.
                </p>
              )}
            </div>
          </div>

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
            <Label htmlFor="ev-desc">Notes</Label>
            <Textarea
              id="ev-desc"
              value={draft.raw_description}
              onChange={(e) => setDraft({ ...draft, raw_description: e.target.value })}
              rows={3}
              placeholder="Optional context"
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Attachments</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById("ev-files")?.click()}
                className="h-8"
              >
                <Paperclip className="h-3 w-3 mr-1.5" />
                Choose files
              </Button>
              <input
                id="ev-files"
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files || []);
                  setFiles((prev) => [...prev, ...list]);
                  e.target.value = "";
                }}
              />
              <span className="text-xs text-muted-foreground">
                {files.length === 0 ? "No files selected" : `${files.length} file(s)`}
              </span>
            </div>
            {files.length > 0 && (
              <ul className="space-y-1 mt-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs border border-border rounded-md px-2 py-1">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Approvals
            </Label>
            {approvals.length > 0 && (
              <ul className="space-y-1">
                {approvals.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs border border-border rounded-md px-2 py-1">
                    <Badge variant="outline" className="text-[10px] uppercase font-mono">{a.approval_type}</Badge>
                    {a.label && <span className="truncate">{a.label}</span>}
                    <span className="text-muted-foreground ml-auto truncate">
                      {a.approver_profile_id
                        ? profiles.find((p) => p.id === a.approver_profile_id)?.display_name || "Unknown"
                        : "No approver"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setApprovals((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border border-dashed border-border rounded-md p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <Select value={appType} onValueChange={setAppType}>
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {APPROVAL_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={appApprover} onValueChange={setAppApprover}>
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Approver" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">No approver yet</SelectItem>
                    {profiles
                      .slice()
                      .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""))
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          {p.display_name || "Unnamed"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={appLabel}
                  onChange={(e) => setAppLabel(e.target.value)}
                  placeholder="Optional note (e.g. 'Hero banner v2')"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => {
                    setApprovals((prev) => [
                      ...prev,
                      {
                        approval_type: appType,
                        label: appLabel,
                        approver_profile_id: appApprover === "none" ? null : appApprover,
                      },
                    ]);
                    setAppLabel("");
                    setAppApprover("none");
                    setAppType("Design");
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !draft.event_name.trim() || !draft.owner.trim()}>
            {saving ? "Saving…" : "Add to diary"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
