import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import type { KeyEvent, WorkstreamCard } from "@/hooks/useKeyEvents";
import { Calendar as CalendarIcon, ExternalLink, AlertTriangle, Layers, Plus, X, Check } from "lucide-react";
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
  objective: "Objective",
  next_action: "Next action",
};

function fmt(iso: string | null, allDay = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

  useEffect(() => {
    setLinkedIds(event?.linked_goal_ids || []);
    setSearch("");
  }, [event?.id, event?.linked_goal_ids]);

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
              </div>
              <SheetTitle className="text-left">{event.event_name || event.title}</SheetTitle>
            </SheetHeader>
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
