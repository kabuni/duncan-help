import { useEffect, useMemo, useState } from "react";
import { Loader2, Send, Sparkles, Mail, CheckCircle2, Circle, XCircle, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";

interface FeatureRequest {
  id: string;
  title: string;
  refined_title: string | null;
  description: string;
  triage_status: string;
  priority_band: string | null;
  effort_band: string | null;
  category: string | null;
  rice_score: number | null;
  clarification_round: number;
  workstream_card_id: string | null;
  created_at: string;
  admin_notes: string | null;
}

interface ThreadMessage {
  id: string;
  role: "agent" | "user" | "system";
  channel: "email" | "in_app" | "system";
  body: string;
  created_at: string;
}

const STATUS_META: Record<string, { icon: any; label: string; tone: string }> = {
  new: { icon: Circle, label: "Duncan reviewing", tone: "text-primary" },
  clarifying: { icon: MessageSquare, label: "Clarification needed", tone: "text-amber-600 dark:text-amber-400" },
  triaged: { icon: Sparkles, label: "Scoring", tone: "text-primary" },
  filed: { icon: CheckCircle2, label: "Filed to backlog", tone: "text-emerald-600 dark:text-emerald-400" },
  dismissed: { icon: XCircle, label: "Closed", tone: "text-muted-foreground" },
};

export default function MyFeatureRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feature_requests")
      .select("id, title, refined_title, description, triage_status, priority_band, effort_band, category, rice_score, clarification_round, workstream_card_id, created_at, admin_notes")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRequests((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!activeId) { setThread([]); return; }
    setThreadLoading(true);
    supabase
      .from("feature_request_messages")
      .select("id, role, channel, body, created_at")
      .eq("feature_request_id", activeId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setThread((data as any) ?? []);
        setThreadLoading(false);
      });
  }, [activeId]);

  const active = useMemo(() => requests.find((r) => r.id === activeId) ?? null, [requests, activeId]);

  const submitReply = async () => {
    if (!user || !active || !reply.trim()) return;
    setSending(true);
    const text = reply.trim();
    const { error } = await supabase.from("feature_request_messages").insert({
      feature_request_id: active.id,
      role: "user",
      channel: "in_app",
      body: text,
    });
    if (error) {
      setSending(false);
      toast.error(error.message);
      return;
    }
    setReply("");
    supabase.functions.invoke("feature-request-agent", {
      body: { feature_request_id: active.id },
    }).catch((e) => console.warn("agent invoke", e));
    const { data } = await supabase
      .from("feature_request_messages")
      .select("id, role, channel, body, created_at")
      .eq("feature_request_id", active.id)
      .order("created_at", { ascending: true });
    setThread((data as any) ?? []);
    setSending(false);
    toast.success("Sent — Duncan is re-reviewing");
    setTimeout(load, 4000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,300px)_1fr] gap-4">
      <aside className="rounded-lg border border-border bg-background/40 p-2 max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : requests.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4 text-center">
            No requests yet. Submit one from the Submit Request tab.
          </p>
        ) : (
          <ul className="space-y-1">
            {requests.map((r) => {
              const meta = STATUS_META[r.triage_status] ?? STATUS_META.new;
              const Icon = meta.icon;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => setActiveId(r.id)}
                    className={`w-full text-left rounded-md p-2.5 transition-colors ${activeId === r.id ? "bg-secondary/70" : "hover:bg-secondary/40"}`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.tone}`} />
                      <span className="text-xs font-medium text-foreground truncate flex-1">
                        {r.refined_title ?? r.title}
                      </span>
                      {r.priority_band && (
                        <span className="text-[10px] font-semibold text-muted-foreground shrink-0">{r.priority_band}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1 pl-5">
                      <span className={`text-[10px] ${meta.tone}`}>{meta.label}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(r.created_at), "MMM d")}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="rounded-lg border border-border bg-background/40 p-4 min-h-[360px]">
        {!active ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Select a request to see Duncan's conversation.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold text-foreground">
                  {active.refined_title ?? active.title}
                </h2>
                <StatusPill status={active.triage_status} priority={active.priority_band} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Submitted {format(new Date(active.created_at), "MMM d, yyyy")}
                {active.category && ` · ${active.category}`}
                {active.rice_score != null && ` · RICE ${active.rice_score.toFixed(1)}`}
                {active.effort_band && ` · Effort ${active.effort_band}`}
              </p>
              {active.admin_notes && active.triage_status === "dismissed" && (
                <p className="mt-3 text-xs text-muted-foreground italic border-l-2 border-border pl-3">
                  Duncan's note: {active.admin_notes}
                </p>
              )}
              {active.workstream_card_id && (
                <a href="/workstreams" className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  View on Product Backlog →
                </a>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Conversation</h3>
              {threadLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : thread.length === 0 ? (
                <p className="text-xs text-muted-foreground">Duncan hasn't posted anything yet.</p>
              ) : (
                <ol className="space-y-3">
                  {thread.map((m) => (
                    <li key={m.id} className={`rounded-lg p-3 ${m.role === "agent" ? "bg-primary/5 border border-primary/15" : "bg-secondary/50"}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                          {m.role === "agent" ? <Sparkles className="h-3 w-3 text-primary" /> : m.channel === "email" ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                          {m.role === "agent" ? "Duncan" : "You"}
                          <span className="text-muted-foreground font-normal">· {m.channel === "email" ? "email" : "in-app"}</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">{format(new Date(m.created_at), "MMM d, HH:mm")}</span>
                      </div>
                      <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {active.triage_status !== "filed" && active.triage_status !== "dismissed" && (
              <div className="border-t border-border pt-4 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Reply to Duncan</label>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  placeholder="Answer Duncan's questions or add more context…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
                <div className="flex justify-end">
                  <button
                    onClick={submitReply}
                    disabled={sending || !reply.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status, priority }: { status: string; priority: string | null }) {
  const meta = STATUS_META[status] ?? STATUS_META.new;
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-secondary/60 ${meta.tone}`}>
        <Icon className="h-3 w-3" /> {meta.label}
      </span>
      {priority && (
        <span className="inline-flex items-center rounded-md bg-primary/15 text-primary px-2 py-0.5 text-[11px] font-semibold">
          {priority}
        </span>
      )}
    </div>
  );
}
