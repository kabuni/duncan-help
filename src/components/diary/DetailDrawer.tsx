import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KeyEvent, KeyEventGoal } from "@/hooks/useKeyEvents";
import { Calendar as CalendarIcon, ExternalLink, AlertTriangle, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const RISK_TONE: Record<string, string> = {
  red: "bg-destructive/15 text-destructive border-destructive/30",
  amber: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  green: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
};

const FIELD_LABELS: Record<string, string> = {
  owner: "Owner",
  objective: "Objective",
  success_metric: "Success metric",
  decision_needed: "Decision needed",
  linked_docs: "Linked docs",
  risks: "Risks",
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
  goal?: KeyEventGoal | null;
  goalEvents?: KeyEvent[];
  goals: KeyEventGoal[];
}

export function DetailDrawer({ open, onOpenChange, event, goal, goalEvents = [], goals }: DetailDrawerProps) {
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
                <Field label="Objective" value={event.objective} />
                <Field label="Success metric" value={event.success_metric} />
                <Field label="Decision needed" value={event.decision_needed} />
                <Field label="Next action" value={event.next_action} />
                <Field label="Risks" value={event.risks} />
                <Field label="Notes" value={event.raw_description} />
              </dl>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Linked docs</div>
                {event.linked_docs && event.linked_docs.length > 0 ? (
                  <ul className="space-y-1">
                    {event.linked_docs.map((d, i) => (
                      <li key={i}>
                        <a href={d} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 break-all">
                          {d} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">None</p>
                )}
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Linked goals</div>
                {event.linked_goal_ids?.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {goals.filter((g) => event.linked_goal_ids.includes(g.id)).map((g) => (
                      <Badge key={g.id} variant="outline" className="text-[10px]">
                        <Target className="h-3 w-3 mr-1" />{g.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">None</p>
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

        {goal && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <Badge variant="outline" className="font-mono text-[10px] uppercase">Goal</Badge>
                <Badge variant="outline" className="text-[10px] capitalize">{goal.status}</Badge>
              </div>
              <SheetTitle className="text-left">{goal.name}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-3 text-sm">
              {goal.target_date && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarIcon className="h-3 w-3" /> Target: {fmt(goal.target_date + "T00:00:00", true)}
                </div>
              )}
              {goal.description && <p className="text-sm leading-6">{goal.description}</p>}
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Linked events ({goalEvents.length})</div>
                {goalEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No events linked yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {goalEvents.map((e) => (
                      <li key={e.id} className="text-xs border border-border rounded-md p-2">
                        <div className="font-medium text-foreground">{e.event_name || e.title}</div>
                        <div className="text-muted-foreground">{fmt(e.start_at, e.all_day)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
