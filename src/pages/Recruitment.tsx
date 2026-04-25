import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fastApi, withFastApi } from "@/lib/fastApiClient";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, RefreshCw, Users, Briefcase, Loader2, CheckCircle, AlertCircle, Star, Target, FileText, Video, ExternalLink, Trophy, AlertTriangle, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { JobRolesManager } from "@/components/recruitment/JobRolesManager";

const VALUE_LABELS = [
  { key: "sweat_the_detail", label: "Detail", emoji: "🔍" },
  { key: "integrity_always", label: "Integrity", emoji: "✨" },
  { key: "behaviour_over_attention", label: "Behaviour", emoji: "🧭" },
  { key: "progress_is_collective", label: "Progress", emoji: "🤝" },
  { key: "health_family_happiness", label: "Health", emoji: "❤️" },
  { key: "build_for_long_term", label: "Long Term", emoji: "🚀" },
];

const INTERVIEW_METRICS = [
  { key: "communication_clarity", label: "Communication", emoji: "🗣️" },
  { key: "structured_thinking", label: "Structure", emoji: "🧠" },
  { key: "role_knowledge", label: "Knowledge", emoji: "📚" },
  { key: "problem_solving", label: "Problem Solving", emoji: "🔧" },
  { key: "confidence_professionalism", label: "Confidence", emoji: "💼" },
  { key: "culture_alignment", label: "Culture Fit", emoji: "🤝" },
  { key: "conciseness_focus", label: "Conciseness", emoji: "🎯" },
];

function ScorePill({ score, label, justification }: { score: number; label: string; justification?: string }) {
  const color = score >= 4 ? "bg-primary/15 text-primary border-primary/20" : score >= 3 ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" : "bg-destructive/10 text-destructive border-destructive/20";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${color} cursor-default`}>
            {label}<span className="font-bold">{score}</span>
          </span>
        </TooltipTrigger>
        {justification && (
          <TooltipContent side="top" className="max-w-xs text-xs">
            {justification}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

function InterviewScorePill({ score, label, reason, evidence }: { score: number; label: string; reason?: string; evidence?: string }) {
  const color = score >= 7 ? "bg-primary/15 text-primary border-primary/20" : score >= 5 ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" : "bg-destructive/10 text-destructive border-destructive/20";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${color} cursor-default`}>
            {label}<span className="font-bold">{score}</span>/10
          </span>
        </TooltipTrigger>
        {(reason || evidence) && (
          <TooltipContent side="top" className="max-w-sm text-xs space-y-1">
            {reason && <p>{reason}</p>}
            {evidence && <p className="italic text-muted-foreground">"{evidence}"</p>}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

function getCandidateCompetencyScore(candidate: any): number | null {
  if (typeof candidate?.competency_score === "number" && Number.isFinite(candidate.competency_score)) {
    return candidate.competency_score;
  }

  const competencies = (candidate?.scoring_details as any)?.competencies;
  if (!competencies || typeof competencies !== "object") {
    return null;
  }

  const scores = Object.values(competencies)
    .map((entry: any) => entry?.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

  if (scores.length === 0) {
    return null;
  }

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(average * 10) / 10;
}

function ScoreRing({ score, label, displayValue }: { score: number | null; label: string; displayValue?: string }) {
  if (score == null) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = (score / 5) * 100;
  const color = score >= 4 ? "text-primary" : score >= 3 ? "text-yellow-500" : "text-destructive";
  const stroke = score >= 4 ? "hsl(var(--primary))" : score >= 3 ? "#eab308" : "hsl(var(--destructive))";
  const r = 18, circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="44" height="44" className="-rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={stroke} strokeWidth="3" strokeDasharray={`${circ * pct / 100} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className={`text-sm font-bold ${color} -mt-8`}>{displayValue ?? score}</span>
      <span className="text-[10px] text-muted-foreground mt-3">{label}</span>
    </div>
  );
}

const Recruitment = () => {
  const { user } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoringCompetencies, setScoringCompetencies] = useState(false);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [sendingInvites, setSendingInvites] = useState(false);
  const [interviewDetailCandidate, setInterviewDetailCandidate] = useState<any>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [validatingPosition, setValidatingPosition] = useState(false);
  const [assigningRole, setAssigningRole] = useState<string | null>(null);

  const { data: gmailStatus } = useQuery({
    queryKey: ["gmail-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_integrations")
        .select("status, last_sync")
        .eq("integration_id", "gmail")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: candidates, refetch: refetchCandidates } = useQuery({
    queryKey: ["candidates", selectedRoleId],
    queryFn: async () => {
      if (!selectedRoleId || !hasFetched) return [];
      const { data, error } = await supabase
        .from("candidates")
        .select("*")
        .eq("job_role_id", selectedRoleId)
        .order("total_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedRoleId && hasFetched,
    refetchInterval: 30000, // Auto-refresh every 30s to pick up cron sync updates
  });

  const { data: jobRoles } = useQuery({
    queryKey: ["job-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_roles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const connectGmail = async () => {
    setConnecting(true);
    try {
      const data = await withFastApi<{ url?: string }>(
        async () => {
          const res = await supabase.functions.invoke("gmail-auth");
          if (res.error) throw res.error;
          return res.data;
        },
        () => fastApi("GET", "/gmail/auth"),
      );
      if (!data?.url) throw new Error("No auth URL returned");
      window.location.href = data.url;
    } catch (err: any) {
      toast.error("Failed to start Gmail connection: " + err.message);
      setConnecting(false);
    }
  };

  const fetchCVs = async () => {
    if (!selectedRoleId) {
      toast.error("Select a role first.");
      return;
    }
    setFetching(true);
    try {
      const data = await withFastApi<{ ingested: number; skipped: number }>(
        async () => {
          const res = await supabase.functions.invoke("fetch-gmail-cvs", {
            body: { role_id: selectedRoleId },
          });
          if (res.error) throw res.error;
          return res.data;
        },
        () => fastApi("POST", "/recruitment/fetch-gmail-cvs", { role_id: selectedRoleId }),
      );
      toast.success(`Fetched ${data.ingested} new CV(s), ${data.skipped} skipped.`);
      setHasFetched(true);
      refetchCandidates();
    } catch (err: any) {
      toast.error("Failed to fetch CVs: " + err.message);
    } finally {
      setFetching(false);
    }
  };

  const handleRoleChange = (roleId: string) => {
    setSelectedRoleId(roleId);
    setHasFetched(false);
    setSelectedCandidates(new Set());
  };

  const assignCandidateRole = async (candidateId: string, newRoleId: string) => {
    setAssigningRole(candidateId);
    try {
      const { error } = await supabase
        .from("candidates")
        .update({ job_role_id: newRoleId })
        .eq("id", candidateId);
      if (error) throw error;
      toast.success("Role assigned successfully");
      refetchCandidates();
    } catch (err: any) {
      toast.error("Failed to assign role: " + err.message);
    } finally {
      setAssigningRole(null);
    }
  };

  const scoreValues = async () => {
    setScoring(true);
    try {
      const data = await withFastApi<{ scored: number; failed?: number }>(
        async () => {
          const res = await supabase.functions.invoke("score-cv-values");
          if (res.error) throw res.error;
          return res.data;
        },
        () => fastApi("POST", "/recruitment/score-values", {}),
      );
      toast.success(`Scored ${data.scored} candidate(s) on values.${data.failed ? ` ${data.failed} failed.` : ""}`);
      refetchCandidates();
    } catch (err: any) {
      toast.error("Failed to score candidates: " + err.message);
    } finally {
      setScoring(false);
    }
  };

  const scoreCompetencies = async () => {
    if (!selectedRoleId) {
      toast.error("Select a role first.");
      return;
    }

    setScoringCompetencies(true);
    try {
      const data = await withFastApi<{ scored: number; skipped?: number; failed?: number; message?: string }>(
        async () => {
          const res = await supabase.functions.invoke("score-cv-competencies", {
            body: { role_id: selectedRoleId },
          });
          if (res.error) throw res.error;
          return res.data;
        },
        () => fastApi("POST", "/recruitment/score-competencies", { role_id: selectedRoleId }),
      );
      if (data.scored === 0 && data.message) {
        toast.message(data.message);
      } else {
        toast.success(`Scored ${data.scored} candidate(s) on competencies.${data.skipped ? ` ${data.skipped} skipped.` : ""}${data.failed ? ` ${data.failed} failed.` : ""}`);
      }
      refetchCandidates();
    } catch (err: any) {
      toast.error("Failed to score competencies: " + err.message);
    } finally {
      setScoringCompetencies(false);
    }
  };

  const downloadCV = async (storagePath: string, candidateName: string) => {
    try {
      const { data, error } = await supabase.storage.from("cvs").createSignedUrl(storagePath, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      toast.error("Failed to open CV: " + err.message);
    }
  };

  const toggleCandidate = (id: string) => {
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRole = jobRoles?.find((r: any) => r.id === selectedRoleId);
  const roleIsLinked = !!selectedRole?.hireflix_position_id;

  const isInviteEligible = (c: any) =>
    c.email && roleIsLinked && c.hireflix_status !== "invited" && c.hireflix_status !== "completed";

  const toggleAll = () => {
    if (!candidates) return;
    const eligible = candidates.filter(isInviteEligible);
    if (selectedCandidates.size === eligible.length) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(eligible.map((c: any) => c.id)));
    }
  };

  const sendHireflixInvites = async () => {
    if (selectedCandidates.size === 0) {
      toast.error("No candidates selected.");
      return;
    }

    // Position validation before invite
    if (!roleIsLinked) {
      toast.error("This role is not linked to Hireflix. Cannot send invites.");
      return;
    }

    setValidatingPosition(true);
    try {
      // Validate position exists in Hireflix via a lightweight check
      const positionId = selectedRole?.hireflix_position_id;
      if (!positionId) {
        toast.error("This role is no longer linked to Hireflix. Please relink.");
        return;
      }

      const data = await withFastApi<{ invited: number; failed: number; skipped: number; results?: any[] }>(
        async () => {
          const res = await supabase.functions.invoke("hireflix-send-invite", {
            body: {
              candidate_ids: Array.from(selectedCandidates),
            },
          });
          if (res.error) throw res.error;
          return res.data;
        },
        () => fastApi("POST", "/hireflix/send-invite", { candidate_ids: Array.from(selectedCandidates) }),
      );
      const d = data;
      if (d.invited > 0) {
        toast.success(`Invited ${d.invited} candidate(s).`);
      }
      if (d.failed > 0) {
        const failedItems = (d.results || []).filter((r: any) => r.status === "failed");
        for (const item of failedItems) {
          toast.error(`${item.name}: ${item.reason}${item.retryQueued ? " (auto-retry queued)" : ""}`);
        }
      }
      if (d.skipped > 0) {
        toast.info(`${d.skipped} skipped (already invited).`);
      }
      setSelectedCandidates(new Set());
      refetchCandidates();
    } catch (err: any) {
      toast.error("Failed to send invites: " + err.message);
    } finally {
      setValidatingPosition(false);
      setSendingInvites(false);
    }
  };

  // Interview sync is now automatic via cron — no manual button needed

  // Check last sync time for delay warning
  const { data: lastSyncLog } = useQuery({
    queryKey: ["hireflix-last-sync"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("completed_at, status")
        .eq("integration", "hireflix")
        .eq("sync_type", "interviews")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    refetchInterval: 60000,
  });

  const syncDelayed = (() => {
    if (!lastSyncLog?.completed_at) return false;
    const lastSync = new Date(lastSyncLog.completed_at).getTime();
    return Date.now() - lastSync > 10 * 60 * 1000;
  })();

  // Fetch candidate retry entries for invite failures
  const { data: candidateRetries } = useQuery({
    queryKey: ["hireflix-retry-queue-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hireflix_retry_queue" as any)
        .select("*")
        .eq("operation", "send_invite")
        .in("status", ["pending", "processing", "failed"]);
      if (error) return [];
      return (data ?? []) as any[];
    },
    refetchInterval: 15000,
  });

  const candidateRetryMap = new Map<string, any>();
  (candidateRetries ?? []).forEach((entry: any) => {
    const cId = entry.payload?.candidate_id;
    if (cId) candidateRetryMap.set(cId, entry);
  });

  const isGmailConnected = gmailStatus?.status === "connected";
  const roleMap = new Map((jobRoles ?? []).map((r: any) => [r.id, r.title]));

  const eligibleCount = candidates?.filter(isInviteEligible).length ?? 0;

  // Top 3 candidates by interview score
  const top3 = (candidates || [])
    .filter((c: any) => c.interview_final_score != null)
    .sort((a: any, b: any) => (b.interview_final_score || 0) - (a.interview_final_score || 0))
    .slice(0, 3);

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Recruitment</h1>
            <p className="text-sm text-muted-foreground">CV ingestion, job role matching & candidate scoring</p>
          </div>
          <div className="flex items-center gap-2">
            {isGmailConnected ? (
              <>
                <Badge variant="outline" className="border-primary/30 text-primary gap-1">
                  <CheckCircle className="h-3 w-3" /> Gmail Connected
                </Badge>
                <Select value={selectedRoleId || ""} onValueChange={handleRoleChange}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select a role…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobRoles ?? []).filter((r: any) => r.status === "active").map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={fetchCVs} disabled={fetching || !selectedRoleId}>
                  {fetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  Fetch CVs
                </Button>
              </>
            ) : (
              <Button onClick={connectGmail} disabled={connecting}>
                {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />}
                Connect Gmail
              </Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: Users, label: "Total Candidates", value: candidates?.length ?? 0, color: "text-primary" },
            { icon: Briefcase, label: "Active Roles", value: jobRoles?.length ?? 0, color: "text-primary" },
            { icon: AlertCircle, label: "Unmatched CVs", value: candidates?.filter((c: any) => c.status === "unmatched").length ?? 0, color: "text-destructive" },
          ].map((stat) => (
            <Card key={stat.label} className="border-border/50">
              <CardContent className="flex items-center gap-3 py-4 px-5">
                <div className={`p-2 rounded-lg bg-secondary ${stat.color}`}>
                  <stat.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold leading-none">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Sync delay warning */}
        {syncDelayed && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-sm text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Interview sync may be delayed — last sync was over 10 minutes ago
          </div>
        )}

        {/* Job Roles */}
        <JobRolesManager />

        {/* Candidates Table */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg font-semibold">Candidates</CardTitle>
              <CardDescription>Ranked by total score · hover score pills for AI justification</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {candidates && candidates.length > 0 && (
                <>
                  <Button size="sm" onClick={scoreValues} disabled={scoring} className="gap-1.5">
                    {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
                    Score Values
                  </Button>
                  <Button size="sm" variant="outline" onClick={scoreCompetencies} disabled={scoringCompetencies} className="gap-1.5">
                    {scoringCompetencies ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                    Score Competencies
                  </Button>
                </>
              )}
              {selectedCandidates.size > 0 && roleIsLinked && (
                <Button
                  size="sm"
                  onClick={sendHireflixInvites}
                  disabled={sendingInvites || validatingPosition}
                  className="gap-1.5 bg-primary"
                >
                  {(sendingInvites || validatingPosition) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                  Send Hireflix Invite ({selectedCandidates.size})
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {candidates && candidates.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="pl-6 w-[50px]">
                        <Checkbox
                          checked={selectedCandidates.size > 0 && selectedCandidates.size === eligibleCount}
                          onCheckedChange={toggleAll}
                          aria-label="Select all candidates"
                        />
                      </TableHead>
                      <TableHead className="w-[180px]">Candidate</TableHead>
                      <TableHead className="w-[120px]">Role</TableHead>
                      <TableHead className="w-[90px]">Status</TableHead>
                      <TableHead className="w-[60px] text-center">CV</TableHead>
                      <TableHead>Values Breakdown</TableHead>
                      <TableHead>Competency Breakdown</TableHead>
                      <TableHead className="text-center w-[160px]">Scores</TableHead>
                      <TableHead className="w-[100px] text-center">Interview</TableHead>
                      <TableHead className="w-[120px] text-center">Interview Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((c: any) => {
                      const details = c.scoring_details as any;
                      const vals = details?.values;
                      const comps = details?.competencies;
                      const compEntries = comps ? (Object.entries(comps) as [string, any][]) : [];
                        const competencyScore = getCandidateCompetencyScore(c);
                        const hireflixLink = c.hireflix_playback_url ?? c.hireflix_interview_url;
                      const isEligible = isInviteEligible(c);

                      return (
                        <TableRow key={c.id} className="border-border/30 group">
                          {/* Checkbox */}
                          <TableCell className="pl-6">
                            <Checkbox
                              checked={selectedCandidates.has(c.id)}
                              onCheckedChange={() => toggleCandidate(c.id)}
                              disabled={!isEligible}
                              aria-label={`Select ${c.name}`}
                            />
                          </TableCell>

                          {/* Candidate info */}
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-foreground shrink-0">
                                {c.name?.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{c.name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{c.email}</p>
                              </div>
                            </div>
                          </TableCell>

                          {/* Role assignment */}
                          <TableCell>
                            <Select
                              value={c.job_role_id || ""}
                              onValueChange={(val) => assignCandidateRole(c.id, val)}
                              disabled={assigningRole === c.id}
                            >
                              <SelectTrigger className="h-7 w-[140px] text-[11px]">
                                <SelectValue placeholder="Assign role…" />
                              </SelectTrigger>
                              <SelectContent>
                                {(jobRoles ?? []).filter((r: any) => r.status === "active").map((r: any) => (
                                  <SelectItem key={r.id} value={r.id} className="text-xs">{r.title}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <Badge
                              variant={c.status === "scored" ? "default" : c.status === "unmatched" ? "destructive" : "secondary"}
                              className="text-[11px]"
                            >
                              {c.status}
                            </Badge>
                          </TableCell>

                          {/* CV Download */}
                          <TableCell className="text-center">
                            {c.cv_storage_path ? (
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => downloadCV(c.cv_storage_path, c.name)}
                                    >
                                      <FileText className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View CV</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>

                          {/* Values breakdown */}
                          <TableCell>
                            {vals ? (
                              <div className="flex flex-wrap gap-1 max-w-[280px]">
                                {VALUE_LABELS.map((v) => {
                                  const s = vals[v.key]?.score;
                                  return s != null ? (
                                    <ScorePill
                                      key={v.key}
                                      score={s}
                                      label={v.emoji}
                                      justification={`${v.label}: ${vals[v.key]?.justification || ""}`}
                                    />
                                  ) : null;
                                })}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>

                          {/* Competencies breakdown */}
                          <TableCell>
                            {compEntries.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-[280px]">
                                {compEntries.map(([name, data]) => (
                                  <ScorePill
                                    key={name}
                                    score={data?.score || 0}
                                    label={name.split(" ").map((w: string) => w[0]).join("")}
                                    justification={`${name}: ${data?.justification || ""}`}
                                  />
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>

                          {/* Score rings */}
                          <TableCell>
                            <div className="flex items-center justify-center gap-3">
                              <ScoreRing score={c.values_score} label="Values" />
                              <ScoreRing
                                score={competencyScore}
                                label="Comp."
                                displayValue={competencyScore != null ? competencyScore.toFixed(1) : undefined}
                              />
                              <div className="flex flex-col items-center border-l border-border/50 pl-3">
                                <span className={`text-xl font-bold ${c.total_score >= 4 ? "text-primary" : c.total_score >= 3 ? "text-yellow-500" : "text-destructive"}`}>
                                  {c.total_score ?? "—"}
                                </span>
                                <span className="text-[10px] text-muted-foreground">Total</span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Hireflix status */}
                          <TableCell className="text-center">
                            {c.hireflix_status === "invited" ? (
                              <div className="flex flex-col items-center gap-1">
                                <Badge variant="outline" className="text-[11px] border-primary/30 text-primary gap-1">
                                  <Video className="h-3 w-3" /> Invited
                                </Badge>
                              </div>
                            ) : c.hireflix_status === "completed" ? (
                              <div className="flex flex-col items-center gap-1">
                                <Badge variant="outline" className="text-[11px] border-primary/30 text-primary gap-1">
                                  <CheckCircle className="h-3 w-3" /> Done
                                </Badge>
                              </div>
                            ) : (() => {
                              const retry = candidateRetryMap.get(c.id);
                              const failureReason = c.failure_reason || retry?.last_error;
                              if (retry?.status === "failed" || (c.failure_reason && !retry)) {
                                return (
                                  <TooltipProvider delayDuration={200}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="destructive" className="text-[10px] gap-1">
                                          <XCircle className="h-3 w-3" /> Failed
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-xs text-xs">
                                        {failureReason || "Invite failed"}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              } else if (retry?.status === "pending" || retry?.status === "processing") {
                                return (
                                  <Badge variant="secondary" className="text-[10px] gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Retrying...
                                  </Badge>
                                );
                              }
                              return <span className="text-muted-foreground text-xs">—</span>;
                            })()}
                            <div className="mt-1">
                              {hireflixLink ? (
                                <a
                                  href={hireflixLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline text-[10px] inline-flex items-center gap-1"
                                >
                                  <ExternalLink className="h-3 w-3" /> Open Interview
                                </a>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">No interview link available</span>
                              )}
                            </div>
                          </TableCell>

                          {/* Interview Score */}
                          <TableCell className="text-center">
                            {c.interview_final_score != null ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className={`text-lg font-bold ${c.interview_final_score >= 7 ? "text-primary" : c.interview_final_score >= 5 ? "text-yellow-500" : "text-destructive"}`}>
                                  {c.interview_final_score}/10
                                </span>
                                {top3.some((t: any) => t.id === c.id) && (
                                  <Badge className="text-[10px] bg-yellow-500/15 text-yellow-600 border-yellow-500/30 gap-0.5">
                                    <Trophy className="h-3 w-3" /> Top 3
                                  </Badge>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-[10px] h-5 px-1.5"
                                  onClick={() => setInterviewDetailCandidate(c)}
                                >
                                  Details
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-12 text-center">
                {!selectedRoleId
                  ? "Select a role above, then click Fetch CVs to load candidates."
                  : !hasFetched
                    ? "Click Fetch CVs to load candidates for the selected role."
                    : "No candidates found for this role."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Top 3 Interview Candidates */}
        {top3.length > 0 && (
          <Card className="border-border/50 border-yellow-500/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" /> Top 3 Interview Candidates
              </CardTitle>
              <CardDescription>Highest scoring candidates from video interviews — only these receive shareable video links</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {top3.map((c: any, idx: number) => {
                  const scores = c.interview_scores as any;
                  const hireflixLink = c.hireflix_playback_url ?? c.hireflix_interview_url;
                  return (
                    <Card key={c.id} className={`border-border/50 ${idx === 0 ? "ring-2 ring-yellow-500/30" : ""}`}>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-lg font-bold ${idx === 0 ? "text-yellow-500" : idx === 1 ? "text-muted-foreground" : "text-orange-400"}`}>
                              #{idx + 1}
                            </span>
                            <div>
                              <p className="font-medium text-sm">{c.name}</p>
                              <p className="text-[11px] text-muted-foreground">{c.email}</p>
                            </div>
                          </div>
                          <span className={`text-2xl font-bold ${c.interview_final_score >= 7 ? "text-primary" : c.interview_final_score >= 5 ? "text-yellow-500" : "text-destructive"}`}>
                            {c.interview_final_score}
                          </span>
                        </div>
                        {scores && (
                          <div className="flex flex-wrap gap-1">
                            {INTERVIEW_METRICS.map((m) => {
                              const s = scores[m.key];
                              return s ? (
                                <InterviewScorePill
                                  key={m.key}
                                  score={s.score}
                                  label={m.emoji}
                                  reason={`${m.label}: ${s.reason}`}
                                  evidence={s.evidence_quote}
                                />
                              ) : null;
                            })}
                          </div>
                        )}
                        {hireflixLink && (
                          <a
                            href={hireflixLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Video className="h-3 w-3" /> Watch Interview
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Interview Score Detail Dialog */}
        <Dialog open={!!interviewDetailCandidate} onOpenChange={(open) => !open && setInterviewDetailCandidate(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Interview Score — {interviewDetailCandidate?.name}</DialogTitle>
              <DialogDescription>AI-evaluated video interview performance breakdown</DialogDescription>
            </DialogHeader>
            {interviewDetailCandidate?.interview_scores && (
              <div className="space-y-3">
                {INTERVIEW_METRICS.map((m) => {
                  const s = (interviewDetailCandidate.interview_scores as any)?.[m.key];
                  if (!s) return null;
                  return (
                    <div key={m.key} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{m.emoji} {m.label}</span>
                        <span className={`text-sm font-bold ${s.score >= 7 ? "text-primary" : s.score >= 5 ? "text-yellow-500" : "text-destructive"}`}>
                          {s.score}/10
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.reason}</p>
                      {s.evidence_quote && (
                        <p className="text-xs italic text-muted-foreground/70 border-l-2 border-border pl-2">
                          "{s.evidence_quote}"
                        </p>
                      )}
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-sm font-semibold">Final Score</span>
                  <span className={`text-xl font-bold ${interviewDetailCandidate.interview_final_score >= 7 ? "text-primary" : interviewDetailCandidate.interview_final_score >= 5 ? "text-yellow-500" : "text-destructive"}`}>
                    {interviewDetailCandidate.interview_final_score}/10
                  </span>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </AppLayout>
  );
};

export default Recruitment;
