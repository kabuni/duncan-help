import { useMemo, useState } from "react";
import { useMeetingRequests, useConfirmMeeting, useTriggerPoll, type MeetingRequest, type MeetingStatus } from "@/hooks/useMeetingRequests";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Inbox, RefreshCw, Calendar as CalIcon, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

const PRIORITY_STYLES: Record<string, string> = {
  P1: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  P2: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  P3: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  P4: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<MeetingStatus, string> = {
  awaiting_purpose: "Awaiting purpose",
  pending_approval: "Pending approval",
  confirmed: "Confirmed",
  declined: "Declined",
  rescheduled: "Rescheduled",
};

function fmtLondon(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d) + " (UK)";
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MeetingCard({ req }: { req: MeetingRequest }) {
  const confirm = useConfirmMeeting();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toLocalInput(req.proposed_slot));

  const canAct = req.status === "pending_approval";

  const handleApprove = () => {
    if (editing && start) {
      const startDate = new Date(start);
      const durationMs = req.proposed_slot && req.proposed_slot_end
        ? new Date(req.proposed_slot_end).getTime() - new Date(req.proposed_slot).getTime()
        : (req.priority === "P3" || req.priority === "P4" ? 30 : 60) * 60_000;
      const endDate = new Date(startDate.getTime() + durationMs);
      confirm.mutate({
        request_id: req.id, action: "approve",
        override_start: startDate.toISOString(),
        override_end: endDate.toISOString(),
      });
    } else {
      confirm.mutate({ request_id: req.id, action: "approve" });
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{req.sender_name}</h3>
            {req.priority && (
              <Badge variant="outline" className={cn("border", PRIORITY_STYLES[req.priority])}>
                {req.priority}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[11px]">{STATUS_LABEL[req.status]}</Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{req.sender_email}</p>
        </div>
        <a
          href={`https://mail.google.com/mail/u/0/#inbox/${req.gmail_thread_id}`}
          target="_blank" rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <Mail className="h-3.5 w-3.5" /> Thread
        </a>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Purpose</div>
          <p className="leading-6">{req.purpose ?? <span className="italic text-muted-foreground">Awaiting response</span>}</p>
        </div>
        {req.priority_reason && (
          <p className="text-xs text-muted-foreground italic">{req.priority_reason}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalIcon className="h-3.5 w-3.5" />
          Proposed: <span className="text-foreground font-medium">{fmtLondon(req.proposed_slot)}</span>
        </div>
      </div>

      {canAct && (
        <div className="space-y-3 pt-2 border-t border-border">
          {editing && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Override start time (local)</label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleApprove} disabled={confirm.isPending}>
              Approve &amp; Confirm
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(v => !v)}>
              {editing ? "Use proposed slot" : "Pick different time"}
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => confirm.mutate({ request_id: req.id, action: "decline" })}
              disabled={confirm.isPending}
            >
              Decline
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

type Filter = "all" | "pending" | "confirmed" | "declined";

export default function EAInbox() {
  const { isAdmin, isLoading: roleLoading } = useIsAdmin();
  const { data: requests = [], isLoading } = useMeetingRequests();
  const triggerPoll = useTriggerPoll();
  const [filter, setFilter] = useState<Filter>("pending");

  const filtered = useMemo(() => {
    if (filter === "all") return requests;
    if (filter === "pending") return requests.filter(r =>
      r.status === "pending_approval" || r.status === "awaiting_purpose");
    if (filter === "confirmed") return requests.filter(r => r.status === "confirmed");
    return requests.filter(r => r.status === "declined");
  }, [requests, filter]);

  if (roleLoading) return null;
  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        EA Inbox is admin-only.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">EA Inbox</h1>
            <p className="text-sm text-muted-foreground">
              Duncan handles inbound meeting requests for Nimesh. Approve a slot to confirm.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => triggerPoll.mutate()} disabled={triggerPoll.isPending}>
          <RefreshCw className={cn("h-4 w-4", triggerPoll.isPending && "animate-spin")} />
          Poll now
        </Button>
      </header>

      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "confirmed", "declined"] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize",
              filter === f
                ? "bg-primary/10 text-primary border-primary/30"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No pending meeting requests.
        </Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map(r => <MeetingCard key={r.id} req={r} />)}
        </div>
      )}
    </div>
  );
}
