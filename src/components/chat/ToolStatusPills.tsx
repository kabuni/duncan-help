import { Loader2, Check, AlertTriangle, Clock } from "lucide-react";
import type { ToolStatus } from "@/hooks/useNormanChat";

const NICE_NAME: Record<string, string> = {
  search_documents: "Documents", list_documents: "Documents", read_document: "Documents",
  list_calendar_events: "Calendar", create_calendar_event: "Calendar", update_calendar_event: "Calendar",
  list_gmail_emails: "Gmail", search_gmail: "Gmail", read_gmail_email: "Gmail", send_gmail_email: "Gmail",
  list_slack_channels: "Slack", send_slack_message: "Slack", read_slack_channel_messages: "Slack",
  list_meetings: "Meetings", get_meeting: "Meetings", search_meeting_transcripts: "Meetings",
};

function label(name: string) {
  return NICE_NAME[name] || name.replace(/_/g, " ");
}

export default function ToolStatusPills({ statuses }: { statuses: ToolStatus[] }) {
  if (!statuses.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {statuses.map((s) => {
        const running = s.state === "running";
        const bad = s.state === "error" || s.state === "timeout" || s.state === "circuit_open";
        const pending = s.state === "pending_confirmation";
        return (
          <span
            key={s.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
              bad
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : pending
                ? "border-amber-400/40 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : running
                ? "border-border bg-muted text-muted-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
            title={s.error || s.state}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> :
              pending ? <Clock className="h-3 w-3" /> :
              bad ? <AlertTriangle className="h-3 w-3" /> :
              <Check className="h-3 w-3" />}
            {label(s.name)}
          </span>
        );
      })}
    </div>
  );
}
