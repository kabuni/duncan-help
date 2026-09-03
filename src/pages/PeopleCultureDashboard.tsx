import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, MessageSquareQuote, RefreshCw, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { RagBadge } from "@/components/company-health/HealthPrimitives";
import { usePeopleCulture } from "@/hooks/usePeopleCulture";
import { supabase } from "@/integrations/supabase/client";

interface CommentSummary {
  headline: string;
  sentiment?: "positive" | "mixed" | "negative";
  themes?: { title: string; detail: string; weight?: string; sentiment?: string }[];
  risks?: string[];
  actions?: string[];
  perQuestion?: { question: string; summary: string; sentiment?: string; responses?: number }[];
}

function sentimentTone(s?: string) {
  if (s === "positive") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (s === "negative") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
}


function tone(score: number) {
  if (score >= 75) return "[&>*]:bg-emerald-500";
  if (score >= 65) return "[&>*]:bg-amber-500";
  return "[&>*]:bg-destructive";
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground/80 mt-1">{sub}</p>}
    </div>
  );
}

const THEME_LABELS: Record<string, string> = {
  satisfaction: "Employee Satisfaction",
  alignment: "Alignment & Growth",
  culture: "Culture & Connection",
};

export default function PeopleCultureDashboard() {
  const { data, isLoading, isFetching, refetch, error, rag } = usePeopleCulture();
  const [q, setQ] = useState("");
  const [summary, setSummary] = useState<CommentSummary | null>(null);
  const [summarising, setSummarising] = useState(false);


  const metrics = data?.metrics ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? metrics.filter((m) => m.question.toLowerCase().includes(needle)) : metrics;
    return [...list].sort((a, b) => a.normalised - b.normalised);
  }, [metrics, q]);

  const maxTimeline = Math.max(1, ...(data?.timeline ?? []).map((t) => t.count));

  const handleRefresh = async () => {
    const res = await refetch();
    if (res.error) {
      toast.error("Couldn't reach the survey sheet", { description: (res.error as Error).message });
      return;
    }
    toast.success(`Synced ${res.data?.responses ?? 0} survey responses`);
  };

  const totalComments = (data?.comments ?? []).reduce((a, c) => a + c.answers.length, 0);

  const generateSummary = async () => {
    if (!data?.comments?.length) {
      toast.error("No free-text answers to summarise yet");
      return;
    }
    setSummarising(true);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("people-culture-comment-summary", {
        body: { comments: data.comments },
      });
      if (fnErr) throw fnErr;
      if ((res as any)?.error) throw new Error((res as any).error);
      if (!(res as any)?.summary) {
        toast.error("No comments available to summarise");
        return;
      }
      setSummary((res as any).summary as CommentSummary);
      toast.success(`Summarised ${totalComments} comments`);
    } catch (e: any) {
      toast.error("Couldn't summarise comments", { description: e?.message });
    } finally {
      setSummarising(false);
    }
  };


  return (
    <main className="flex-1 overflow-y-auto">
      <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />
      <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-7xl space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary glow-primary-sm shrink-0">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
                People &amp; Culture
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Every question from the employee survey, live from the responses sheet
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/company-health">
                <ArrowLeft className="h-3.5 w-3.5" /> Company Health
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              {isFetching ? "Syncing…" : "Refresh"}
            </Button>
          </div>
        </header>

        {isLoading && <p className="text-xs text-muted-foreground">Loading survey responses…</p>}
        {error && (
          <p className="text-xs text-destructive">
            Survey sync failed: {(error as Error).message}
          </p>
        )}

        {data && (
          <>
            {/* Headline */}
            <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Stat label="Culture index (0–100)" value={data.overall !== null ? Math.round(data.overall) : "—"} />
              <Stat label="eNPS" value={data.enps ?? "—"} sub={data.enpsBreakdown ? `${data.enpsBreakdown.promoters} promoters · ${data.enpsBreakdown.detractors} detractors` : undefined} />
              <Stat label="Responses captured" value={data.responses} />
              <Stat label="Questions scored" value={metrics.length} />
              <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between">
                <RagBadge rag={rag} size="md" />
                <p className="text-[11px] text-muted-foreground mt-2">
                  {data.lastResponse
                    ? `Latest response ${new Date(data.lastResponse).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                    : "No timestamped responses"}
                </p>
              </div>
            </section>

            {/* Themes */}
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
              <h2 className="text-sm font-semibold text-foreground tracking-tight">Theme indices</h2>
              {data.themes.map((t) => (
                <div key={t.key} className="space-y-1 pt-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">{t.label}</p>
                      <p className="text-[11px] text-muted-foreground">{t.description} · {t.questions} question{t.questions === 1 ? "" : "s"}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                      {Math.round(t.score)}<span className="text-muted-foreground font-normal"> / 100</span>
                    </p>
                  </div>
                  <Progress value={t.score} className={tone(t.score)} />
                </div>
              ))}
            </section>

            <Tabs defaultValue="questions">
              <TabsList>
                <TabsTrigger value="questions">Questions ({metrics.length})</TabsTrigger>
                <TabsTrigger value="comments">Comments ({data.comments.reduce((a, c) => a + c.answers.length, 0)})</TabsTrigger>
                <TabsTrigger value="demographics">Breakdowns ({data.breakdowns.length})</TabsTrigger>
                <TabsTrigger value="participation">Participation</TabsTrigger>
              </TabsList>

              {/* Every scored question with its distribution */}
              <TabsContent value="questions" className="space-y-3 pt-4">
                <Input
                  placeholder="Search questions…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="max-w-sm h-9"
                />
                {filtered.length === 0 && <p className="text-xs text-muted-foreground">No matching questions.</p>}
                <div className="grid gap-3 lg:grid-cols-2">
                  {filtered.map((m) => {
                    const maxCount = Math.max(1, ...(m.distribution ?? []).map((d) => d.count));
                    return (
                      <div key={m.question} className="rounded-xl border border-border bg-card p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs font-medium text-foreground leading-5">{m.question}</p>
                          <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                            {m.average}<span className="text-muted-foreground font-normal"> / {m.scaleMax}</span>
                          </p>
                        </div>
                        <Progress value={m.normalised} className={tone(m.normalised)} />
                        <p className="text-[11px] text-muted-foreground">
                          {Math.round(m.normalised)} / 100 · {m.responses} responses
                          {m.theme ? ` · ${THEME_LABELS[m.theme] ?? m.theme}` : ""}
                        </p>
                        {!!m.distribution?.length && (
                          <div className="flex items-end gap-1 h-16 pt-1">
                            {m.distribution.map((d) => (
                              <div key={d.value} className="flex-1 flex flex-col items-center gap-1" title={`${d.count} chose ${d.value}`}>
                                <div
                                  className="w-full rounded-sm bg-primary/70"
                                  style={{ height: `${Math.max(4, (d.count / maxCount) * 44)}px` }}
                                />
                                <span className="text-[10px] text-muted-foreground tabular-nums">{d.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              {/* Verbatim free-text answers */}
              <TabsContent value="comments" className="space-y-4 pt-4">
                {data.comments.length === 0 && (
                  <p className="text-xs text-muted-foreground">No free-text answers in the survey.</p>
                )}
                {data.comments.map((c) => (
                  <div key={c.question} className="rounded-xl border border-border bg-card p-4 space-y-2">
                    <p className="text-xs font-semibold text-foreground">{c.question}</p>
                    <div className="space-y-2">
                      {c.answers.map((a, i) => (
                        <p key={i} className="text-[12px] leading-6 text-muted-foreground flex gap-2">
                          <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 mt-1 text-primary/70" />
                          <span>{a}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </TabsContent>

              {/* Categorical questions (department, tenure, etc.) */}
              <TabsContent value="demographics" className="grid gap-3 lg:grid-cols-2 pt-4">
                {data.breakdowns.length === 0 && (
                  <p className="text-xs text-muted-foreground">No categorical questions in the survey.</p>
                )}
                {data.breakdowns.map((b) => {
                  const total = b.options.reduce((a, o) => a + o.count, 0) || 1;
                  return (
                    <div key={b.question} className="rounded-xl border border-border bg-card p-4 space-y-2">
                      <p className="text-xs font-semibold text-foreground">{b.question}</p>
                      {b.options.map((o) => (
                        <div key={o.label} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="text-muted-foreground truncate">{o.label}</span>
                            <span className="tabular-nums text-foreground">{o.count} · {Math.round((o.count / total) * 100)}%</span>
                          </div>
                          <Progress value={(o.count / total) * 100} />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="participation" className="pt-4">
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <p className="text-xs font-semibold text-foreground">Responses per month</p>
                  {data.timeline.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No timestamps available.</p>
                  ) : (
                    <div className="flex items-end gap-3 h-40">
                      {data.timeline.map((t) => (
                        <div key={t.period} className="flex-1 flex flex-col items-center gap-1.5">
                          <span className="text-[10px] tabular-nums text-muted-foreground">{t.count}</span>
                          <div
                            className="w-full rounded-t bg-primary/70"
                            style={{ height: `${Math.max(4, (t.count / maxTimeline) * 110)}px` }}
                          />
                          <span className="text-[10px] text-muted-foreground">{t.period}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </main>
  );
}
