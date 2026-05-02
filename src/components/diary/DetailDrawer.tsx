import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { KeyEvent, WorkstreamCard } from "@/hooks/useKeyEvents";
import { Calendar as CalendarIcon, ExternalLink, AlertTriangle, Layers, Plus, X, Check, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { EventAttachments } from "./EventAttachments";
import { EventApprovals } from "./EventApprovals";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const RISK_TONE: Record<string, string> = {
  red: "bg-destructive/15 text-destructive border-destructive/30",
  amber: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  green: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
};

const FIELD_LABELS: Record<string, string> = {
  owner: "Owner",
};

const CATEGORIES = [
  "Event", "Holiday", "Marketing", "Launch", "Investor",
  "Product", "Operations", "Travel", "Releases", "Other",
];

function fmt(iso: string | null, allDay = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function isoToDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}
function isoToTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: KeyEvent | null;
  cards: WorkstreamCard[];
  isAdmin: boolean;
  onChanged: () => void;
}

export function DetailDrawer({ open, onOpenChange, event, cards, isAdmin, onChanged }: DetailDrawerProps) {
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [owners, setOwners] = useState<{ display_name: string; user_id?: string }[]>([]);
  const [form, setForm] = useState({
    event_name: "",
    category: "Event",
    owner: "",
    location: "",
    raw_description: "",
    all_day: false,
    start_date: "",
    start_time: "",
    end_date: "",
    end_time: "",
  });

  useEffect(() => {
    setLinkedIds(event?.linked_goal_ids || []);
    setSearch("");
    setEditing(false);
    if (event) {
      setForm({
        event_name: event.event_name || "",
        category: event.category || "Event",
        owner: event.owner || "",
        location: event.location || "",
        raw_description: event.raw_description || "",
        all_day: event.all_day,
        start_date: isoToDate(event.start_at),
        start_time: isoToTime(event.start_at),
        end_date: isoToDate(event.end_at),
        end_time: isoToTime(event.end_at),
      });
    }
  }, [event?.id]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setCurrentUserId(u.user?.id || null);
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("approval_status", "approved")
        .order("display_name");
      setOwners(((data || []) as any).filter((p: any) => p.display_name));
    })();
  }, [open]);

  const canEdit = useMemo(() => {
    if (!event) return false;
    // Strict ownership: only the original creator can edit, even admins cannot.
    return !!currentUserId && event.created_by === currentUserId;
  }, [event, currentUserId]);

  const canEditFinal = canEdit;

  const linkedCards = cards.filter((c) => linkedIds.includes(c.id));
  const availableCards = cards.filter(
    (c) => !linkedIds.includes(c.id) && c.title.toLowerCase().includes(search.toLowerCase())
  );

  async function persist(nextIds: string[]) {
    if (!event) return;
    setSaving(true);
    const { error } = await supabase
      .from("key_events" as any)
      .update({ linked_goal_ids: nextIds })
      .eq("id", event.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLinkedIds(nextIds);
    onChanged();
  }

  async function addCard(id: string) {
    if (linkedIds.includes(id)) return;
    await persist([...linkedIds, id]);
    setSearch("");
    setPickerOpen(false);
  }

  async function removeCard(id: string) {
    await persist(linkedIds.filter((x) => x !== id));
  }

  async function saveEdits() {
    if (!event) return;
    if (!form.event_name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!form.owner.trim()) {
      toast.error("Owner is required — every event needs an accountable owner");
      return;
    }
    if (!form.start_date) {
      toast.error("Start date is required");
      return;
    }
    setSaving(true);

    const startISO = form.all_day
      ? new Date(`${form.start_date}T00:00:00`).toISOString()
      : new Date(`${form.start_date}T${form.start_time || "09:00"}:00`).toISOString();
    const endISO = form.all_day
      ? new Date(`${form.end_date || form.start_date}T23:59:59`).toISOString()
      : new Date(`${form.end_date || form.start_date}T${form.end_time || form.start_time || "10:00"}:00`).toISOString();

    const missing: string[] = [];
    if (!form.owner.trim()) missing.push("owner");
    const isComplete = missing.length === 0;

    const { error } = await supabase
      .from("key_events" as any)
      .update({
        event_name: form.event_name.trim(),
        title: `[${form.category}] ${form.event_name.trim()}`,
        category: form.category,
        owner: form.owner.trim(),
        location: form.location.trim() || null,
        raw_description: form.raw_description.trim() || null,
        all_day: form.all_day,
        start_at: startISO,
        end_at: endISO,
        missing_fields: missing,
        is_complete: isComplete,
        risk_level: isComplete ? "green" : "amber",
        risk_reason: isComplete ? null : `Missing ${missing.join(", ")}`,
      })
      .eq("id", event.id);

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Event updated");
    setEditing(false);
    onChanged();
  }

  async function deleteEvent() {
    if (!event) return;
    setSaving(true);
    const { error } = await supabase
      .from("key_events" as any)
      .delete()
      .eq("id", event.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Event deleted");
    onOpenChange(false);
    onChanged();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {event && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2 flex-wrap">
                {event.category && (
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">{event.category}</Badge>
                )}
                <Badge className={cn("border text-[10px]", RISK_TONE[event.risk_level])}>{event.risk_level}</Badge>
                {canEditFinal && !editing && (
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                          disabled={saving}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes "{event.event_name || event.title}" and any approvals or attachments tied to it. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={deleteEvent}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete event
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
              <SheetTitle className="text-left">{event.event_name || event.title}</SheetTitle>
            </SheetHeader>

            {editing ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="space-y-1.5">
                  <Label>Name *</Label>
                  <Input
                    value={form.event_name}
                    onChange={(e) => setForm({ ...form, event_name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Owner *</Label>
                    <Select value={form.owner} onValueChange={(v) => setForm({ ...form, owner: v })}>
                      <SelectTrigger><SelectValue placeholder="Required" /></SelectTrigger>
                      <SelectContent>
                        {owners.map((o) => (
                          <SelectItem key={o.display_name} value={o.display_name}>
                            {o.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="ed-allday"
                    checked={form.all_day}
                    onCheckedChange={(v) => setForm({ ...form, all_day: !!v })}
                  />
                  <Label htmlFor="ed-allday" className="cursor-pointer text-sm font-normal">All day</Label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Start date</Label>
                    <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End date</Label>
                    <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                  </div>
                  {!form.all_day && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Start time</Label>
                        <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>End time</Label>
                        <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea rows={3} value={form.raw_description} onChange={(e) => setForm({ ...form, raw_description: e.target.value })} />
                </div>

                <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-background border-t border-border flex gap-2 mt-4">
                  <Button onClick={saveEdits} disabled={saving || !form.event_name.trim() || !form.owner.trim()} className="flex-1">
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                  <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarIcon className="h-3 w-3" /> {fmt(event.start_at, event.all_day)}
                </div>
                {event.risk_reason && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {event.risk_reason}
                  </div>
                )}
                {event.missing_fields.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {event.missing_fields.map((f) => (
                      <Badge key={f} variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                        Missing: {FIELD_LABELS[f] || f}
                      </Badge>
                    ))}
                  </div>
                )}
                <dl className="grid grid-cols-1 gap-y-2 leading-6 text-sm">
                  <Field label="Owner" value={event.owner} />
                  <Field label="Category" value={event.category} />
                  <Field label="Location" value={event.location} />
                  <Field label="Notes" value={event.raw_description} />
                </dl>

                <EventAttachments eventId={event.id} />

                <EventApprovals eventId={event.id} />

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs text-muted-foreground">Linked workstream cards</div>
                    {isAdmin && (
                      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={saving}>
                            <Plus className="h-3 w-3 mr-1" /> Link
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-72 p-2">
                          <Input
                            autoFocus
                            placeholder="Search workstream cards…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-8 text-xs mb-2"
                          />
                          <div className="max-h-64 overflow-y-auto space-y-1">
                            {availableCards.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic px-1 py-2">No matching cards</p>
                            ) : (
                              availableCards.slice(0, 30).map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => addCard(c.id)}
                                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2"
                                >
                                  <Check className="h-3 w-3 opacity-0" />
                                  <span className="truncate flex-1">{c.title}</span>
                                  {c.status && <span className="text-muted-foreground text-[10px] uppercase">{c.status}</span>}
                                </button>
                              ))
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  {linkedCards.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">None linked</p>
                  ) : (
                    <ul className="space-y-1">
                      {linkedCards.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center justify-between gap-2 border border-border rounded-md px-2 py-1.5 text-xs"
                        >
                          <a
                            href={`/projects?card=${c.id}`}
                            className="flex items-center gap-1.5 truncate hover:text-primary"
                            title={c.title}
                          >
                            <Layers className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.title}</span>
                            {c.status && (
                              <Badge variant="outline" className="text-[10px] capitalize ml-1">{c.status}</Badge>
                            )}
                          </a>
                          {isAdmin && (
                            <button
                              onClick={() => removeCard(c.id)}
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              disabled={saving}
                              title="Unlink"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {event.html_link && (
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a href={event.html_link} target="_blank" rel="noreferrer">
                      Open in Google Calendar <ExternalLink className="h-3 w-3 ml-1.5" />
                    </a>
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm whitespace-pre-wrap", !value && "text-muted-foreground italic")}>
        {value || "Not set"}
      </dd>
    </div>
  );
}
