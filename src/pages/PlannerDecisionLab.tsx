import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Play, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * TEST / DEVELOPER VIEW — not part of the normal Planner experience.
 * Route: /planner/decision-lab (admin only, unlinked from navigation).
 *
 * Sends raw natural language to the planner-orchestrate edge function with
 * interpret=true and renders the decision the orchestration layer made.
 */

const SCENARIOS = [
  "I'm taking next Friday off.",
  "Book a meeting with Sarah tomorrow at 2pm for 30 minutes.",
  "Project Alpha needs to be finished by 30 September.",
  "The company Christmas party is on 18 December.",
  "I'm taking next Friday off.",
  "Move my holiday from Friday to Monday.",
  "Put a meeting in with Sarah.",
  "I have a project launch on 30 September at 10am with the whole team.",
];

type Trace = {
  intent: string;
  event_type: string;
  destination: string[];
  source_of_truth: string;
  requires_approval: boolean;
  reason: string;
  existing_event_found: boolean;
  duplicate_detected: boolean;
  conflict_detected: boolean;
  action_taken: string;
  linked: boolean;
  link_group: string | null;
  planner_event_id: string | null;
  google_event_id: string | null;
  planner_category?: string;
  approver_name?: string | null;
  approval_routed?: boolean;
  approval_id?: string | null;
};

type RunResult = {
  utterance: string;
  ran_at: string;
  ok: boolean;
  message?: string;
  error?: string;
  trace?: Trace;
  interpretation?: any;
  request?: any;
  conflicts?: any[];
  suggestions?: { start: string; end: string }[];
  duplicate?: any;
  availability?: any;
};

const Flag = ({ on, label }: { on: boolean; label: string }) => (
  <span className="inline-flex items-center gap-1.5 text-sm">
    <span
      className={`h-2 w-2 rounded-full ${on ? "bg-amber-500" : "bg-muted-foreground/30"}`}
      aria-hidden
    />
    <span className={on ? "font-medium" : "text-muted-foreground"}>
      {label}: {on ? "Yes" : "No"}
    </span>
  </span>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="text-sm font-medium">{children}</div>
  </div>
);

export default function PlannerDecisionLab() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [custom, setCustom] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [planner, setPlanner] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [loadingState, setLoadingState] = useState(false);

  const refreshState = async () => {
    setLoadingState(true);
    const [{ data: events }, { data: linkRows }] = await Promise.all([
      supabase
        .from("key_events")
        .select("id, event_name, title, category, event_type, start_at, end_at, all_day, link_group, approval_state, deleted_in_google")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("event_links")
        .select("link_group, event_type, source_of_truth, destinations, planner_event_id, google_event_id, created_at")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    setPlanner(events || []);
    setLinks(linkRows || []);
    setLoadingState(false);
  };

  const run = async (utterance: string) => {
    setRunning(utterance + Date.now());
    try {
      const { data, error } = await supabase.functions.invoke("planner-orchestrate", {
        body: { utterance, interpret: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      if (error) throw error;
      setResults((prev) => [
        { utterance, ran_at: new Date().toISOString(), ...(data as any) },
        ...prev,
      ]);
      await refreshState();
    } catch (e: any) {
      toast.error(e?.message || "Run failed");
      setResults((prev) => [
        { utterance, ran_at: new Date().toISOString(), ok: false, error: e?.message },
        ...prev,
      ]);
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    for (const s of SCENARIOS) {
      // eslint-disable-next-line no-await-in-loop
      await run(s);
    }
  };

  if (adminLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        This test view is restricted to administrators.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-10">
      <header className="space-y-2">
        <Badge variant="outline" className="uppercase tracking-wide">Test / developer view</Badge>
        <h1 className="text-2xl font-semibold">Planner decision lab</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sends real natural language through the destination decision engine and shows exactly
          what it decided. Requests write to the real Planner and Google Calendar, so treat
          anything created here as test data.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run a request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={custom}
              placeholder="Type anything, e.g. I'm off next Thursday"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) run(custom.trim());
              }}
            />
            <Button disabled={!custom.trim() || !!running} onClick={() => run(custom.trim())}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            </Button>
          </div>
          <Separator />
          <div className="space-y-2">
            {SCENARIOS.map((s, i) => (
              <div key={`${s}-${i}`} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <span className="text-sm">
                  <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                  {s}
                  {i === 4 && <span className="ml-2 text-xs text-muted-foreground">(repeat — expect duplicate detection)</span>}
                </span>
                <Button size="sm" variant="outline" disabled={!!running} onClick={() => run(s)}>
                  Run
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!!running} onClick={runAll}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Run all eight in order
            </Button>
            <Button variant="ghost" onClick={() => setResults([])}>
              <Trash2 className="mr-2 h-4 w-4" /> Clear results
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Decisions ({results.length})
        </h2>
        {results.length === 0 && (
          <p className="text-sm text-muted-foreground">No requests run yet.</p>
        )}
        {results.map((r, idx) => (
          <Card key={idx}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">&ldquo;{r.utterance}&rdquo;</CardTitle>
              <p className="text-sm text-muted-foreground">{r.message || r.error || "—"}</p>
            </CardHeader>
            <CardContent className="space-y-5">
              {r.trace ? (
                <>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <Field label="Intent detected">{r.trace.intent}</Field>
                    <Field label="Event type">{r.trace.event_type}</Field>
                    <Field label="Destination">
                      {r.trace.destination.length === 2 ? "Both" : r.trace.destination[0] === "PLANNER" ? "Planner" : "Google Calendar"}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({r.trace.destination.join(" + ")})
                      </span>
                    </Field>
                    <Field label="Source of truth">{r.trace.source_of_truth}</Field>
                    <Field label="Action taken">{r.trace.action_taken}</Field>
                    <Field label="Records linked">
                      {r.trace.linked ? `Yes — ${r.trace.link_group}` : r.trace.link_group ? `Single system (${r.trace.link_group})` : "No"}
                    </Field>
                    <Field label="Planner category">{r.trace.planner_category || "—"}</Field>
                    <Field label="Approver">
                      {r.trace.approval_routed
                        ? r.trace.approver_name || "Line manager"
                        : r.trace.requires_approval
                          ? "Not routed"
                          : "—"}
                    </Field>
                    <Field label="Planner record">{r.trace.planner_event_id ? r.trace.planner_event_id.slice(0, 8) : "—"}</Field>
                    <Field label="Google record">{r.trace.google_event_id ? r.trace.google_event_id.slice(0, 12) : "—"}</Field>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <Flag on={r.trace.existing_event_found} label="Existing event found" />
                    <Flag on={r.trace.duplicate_detected} label="Duplicate detected" />
                    <Flag on={r.trace.conflict_detected} label="Conflict" />
                    <Flag on={r.trace.requires_approval} label="Needs approval" />
                  </div>
                  <p className="text-xs text-muted-foreground">Rule: {r.trace.reason}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No decision returned.</p>
              )}

              {r.suggestions && r.suggestions.length > 0 && (
                <div className="rounded-md border p-3 text-sm">
                  <div className="mb-1 font-medium">Suggested alternatives</div>
                  <ul className="space-y-1 text-muted-foreground">
                    {r.suggestions.map((s) => (
                      <li key={s.start}>
                        {new Date(s.start).toLocaleString()} – {new Date(s.end).toLocaleTimeString()}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {r.interpretation && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Interpreted request</summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-muted p-3">
                    {JSON.stringify({ interpretation: r.interpretation, request: r.request }, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Resulting data
          </h2>
          <Button size="sm" variant="ghost" onClick={refreshState} disabled={loadingState}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingState ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Planner records (latest 15)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {planner.length === 0 && <p className="text-muted-foreground">Nothing loaded.</p>}
              {planner.map((e) => (
                <div key={e.id} className="rounded border px-3 py-2">
                  <div className="font-medium">
                    {e.event_name || e.title}
                    {e.deleted_in_google && <span className="ml-2 text-xs text-muted-foreground">(cancelled)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.event_type || e.category} · {e.start_at ? new Date(e.start_at).toLocaleString() : "—"}
                    {e.link_group ? ` · ${e.link_group}` : ""}
                    {e.approval_state ? ` · ${e.approval_state}` : ""}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Linked event groups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {links.length === 0 && <p className="text-muted-foreground">Nothing loaded.</p>}
              {links.map((l) => (
                <div key={l.link_group} className="rounded border px-3 py-2">
                  <div className="font-medium">{l.link_group}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.event_type} · truth: {l.source_of_truth} · {(l.destinations || []).join(" + ")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Planner: {l.planner_event_id ? l.planner_event_id.slice(0, 8) : "—"} · Google:{" "}
                    {l.google_event_id ? String(l.google_event_id).slice(0, 12) : "—"}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
