import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranch, AlertTriangle,
  Clock, RefreshCw, Loader2, Activity, Search, X,
  BarChart3, Globe2, Users, MousePointerClick, PlugZap, Send,
  GitPullRequest, GitCommit, FolderGit2, Building2, Inbox, Receipt,
  ShieldCheck, XCircle, CalendarClock, CheckCircle, FileText, Plane,
} from "lucide-react";
import SuppliersDirectory from "@/components/suppliers/SuppliersDirectory";
import Approvals from "@/pages/Approvals";
import PurchaseOrders from "@/pages/PurchaseOrders";
import { useApprovalCount, useApprovals } from "@/hooks/useApprovals";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useTravelRequests } from "@/hooks/useTravelRequests";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

import { useGoogleAnalytics } from "@/hooks/useGoogleAnalytics";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { azureReposApi, type TeamActivitySummary, type AzureRepo, type AzurePullRequest } from "@/lib/api/azureRepos";
import { toast } from "sonner";

function useWorkItems() {
  return useQuery({
    queryKey: ["azure-work-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("azure_work_items")
        .select("*")
        .order("changed_date", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });
}

function useSyncLogs() {
  return useQuery({
    queryKey: ["sync-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

function useReposSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["azure-repos-summary"],
    queryFn: () => azureReposApi.teamActivitySummary(7),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

function useReposList(enabled: boolean) {
  return useQuery({
    queryKey: ["azure-repos-list"],
    queryFn: () => azureReposApi.listRepos(),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

function useActivePRs(enabled: boolean) {
  return useQuery({
    queryKey: ["azure-active-prs"],
    queryFn: () => azureReposApi.listPullRequests({ status: "active", top: 50 }),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

const stateColors: Record<string, string> = {
  "New": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Active": "bg-primary/10 text-primary border-primary/20",
  "Resolved": "bg-norman-success/10 text-norman-success border-norman-success/20",
  "Closed": "bg-muted text-muted-foreground border-border",
  "Removed": "bg-destructive/10 text-destructive border-destructive/20",
};

// Unified tile primitives — keep Operations visually consistent with Home dashboard.
const StatTile = ({
  icon: Icon, label, value, iconClass = "text-primary", delay = 0,
}: { icon: any; label: string; value: React.ReactNode; iconClass?: string; delay?: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.3 }}
    className="rounded-xl border border-border bg-card p-4 sm:p-5"
  >
    <div className="flex items-center gap-2 mb-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      <Icon className={`h-3 w-3 ${iconClass}`} />
      {label}
    </div>
    <p className="text-xl font-bold text-foreground tracking-tight">{value}</p>
  </motion.div>
);

const PanelHeader = ({ icon: Icon, title }: { icon: any; title: string }) => (
  <div className="flex items-center gap-2 mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
    <Icon className="h-3 w-3" />
    {title}
  </div>
);

const Operations = () => {
  const { data: workItems = [], isLoading: wiLoading } = useWorkItems();
  const { data: syncLogs = [], isLoading: slLoading } = useSyncLogs();
  const { data: pendingApprovals = 0 } = useApprovalCount();
  const { data: approvalRows = [] } = useApprovals();
  const { data: pos = [] } = usePurchaseOrders();
  const { data: travelReqs = [] } = useTravelRequests();
  const analytics = useGoogleAnalytics();
  const { isAdmin } = useIsAdmin();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [analyticsQuestion, setAnalyticsQuestion] = useState("Where do we have the most website reach?");
  const [analyticsAnswer, setAnalyticsAnswer] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("work-items");

  const sectionOf: Record<string, "overview" | "action" | "directory"> = {
    "work-items": "overview",
    "repos": "overview",
    "analytics": "overview",
    "sync-logs": "overview",
    "approvals": "action",
    "authorisation": "action",
    "suppliers": "directory",
  };
  const section = sectionOf[activeTab] ?? "overview";
  const sectionDefaults: Record<"overview" | "action" | "directory", string> = {
    overview: "work-items",
    action: "approvals",
    directory: "suppliers",
  };

  const reposEnabled = activeTab === "repos";
  const { data: reposSummary, isLoading: reposLoading, error: reposError, refetch: refetchRepos } = useReposSummary(reposEnabled);
  const { data: reposListResp, isLoading: reposListLoading } = useReposList(reposEnabled);
  const { data: activePRsResp, isLoading: prsLoading } = useActivePRs(reposEnabled);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [releaseFilter, setReleaseFilter] = useState<string>("all");

  // Reset release filter when project changes (releases are project-scoped)
  useEffect(() => {
    setReleaseFilter("all");
  }, [projectFilter]);

  // Release comes from the Azure DevOps "Release" field on User Stories
  // (Custom.MVPRelease, e.g. "Future"), populated by the sync.
  // Unset User Stories fall back to "Future" to match Azure's UI default.
  const defaultRelease = "Future";
  const getRelease = (w: any): string | null => {
    const r = (w?.release || "").toString().trim();
    if (r) return r;
    if (w?.work_item_type === "User Story") return defaultRelease;
    return null;
  };

  // Unique filter options
  const filterOptions = useMemo(() => {
    const states = new Set<string>();
    const types = new Set<string>();
    const assignees = new Set<string>();
    const projects = new Set<string>();
    const releases = new Set<string>();
    const pf = projectFilter.toString().trim().toLowerCase();
    workItems.forEach((w: any) => {
      if (w.state) states.add(w.state);
      if (w.work_item_type) types.add(w.work_item_type);
      if (w.assigned_to) assignees.add(w.assigned_to);
      if (w.project_name) projects.add(w.project_name);
      // Scope releases to currently selected project
      if (projectFilter === "all" || (w.project_name || "").toString().trim().toLowerCase() === pf) {
        const r = getRelease(w);
        if (r) releases.add(r);
      }
    });
    return {
      states: Array.from(states).sort(),
      types: Array.from(types).sort(),
      assignees: Array.from(assignees).sort(),
      projects: Array.from(projects).sort(),
      releases: Array.from(releases).sort(),
    };
  }, [workItems, projectFilter]);

  const filteredItems = useMemo(() => {
    const list = workItems.filter((w: any) => {
      if (stateFilter !== "all" && w.state !== stateFilter) return false;
      if (typeFilter !== "all" && w.work_item_type !== typeFilter) return false;
      if (assigneeFilter === "__unassigned__") {
        if (w.assigned_to) return false;
      } else if (assigneeFilter !== "all") {
        if (w.assigned_to !== assigneeFilter) return false;
      }
      if (projectFilter !== "all") {
        const wp = (w.project_name || "").toString().trim().toLowerCase();
        const pf = projectFilter.toString().trim().toLowerCase();
        if (wp !== pf) return false;
      }
      if (releaseFilter !== "all") {
        const r = getRelease(w);
        if (releaseFilter === "__none__") {
          if (r) return false;
        } else if (r !== releaseFilter) {
          return false;
        }
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!w.title?.toLowerCase().includes(q) && !String(w.external_id).includes(q)) return false;
      }
      return true;
    });
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return [...list].sort((a, b) => collator.compare(a.title || "", b.title || ""));
  }, [workItems, stateFilter, typeFilter, assigneeFilter, projectFilter, releaseFilter, searchQuery, defaultRelease]);

  const hasActiveFilters = stateFilter !== "all" || typeFilter !== "all" || assigneeFilter !== "all" || projectFilter !== "all" || releaseFilter !== "all" || searchQuery !== "";
  const clearFilters = () => {
    setStateFilter("all"); setTypeFilter("all"); setAssigneeFilter("all"); setProjectFilter("all"); setReleaseFilter("all"); setSearchQuery("");
  };

  const handleSync = async (type: "azure") => {
    setSyncing(type);
    try {
      const { error } = await supabase.functions.invoke("sync-azure-work-items");
      if (error) throw error;
      toast.success("Azure DevOps sync started");
    } catch (err: any) {
      toast.error(err.message || "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  const handleAskAnalytics = async () => {
    if (!analyticsQuestion.trim()) return;
    try {
      const answer = await analytics.askQuestion(analyticsQuestion.trim());
      setAnalyticsAnswer(answer);
    } catch (err: any) {
      toast.error(err.message || "Duncan could not answer that analytics question");
    }
  };

  // Stats
  const activeItems = workItems.filter((w: any) => w.state === "Active" || w.state === "New").length;
  const blockedItems = workItems.filter((w: any) => w.tags?.toLowerCase().includes("blocked")).length;

  // Approvals stats
  const approvalPending = approvalRows.filter((r) => r.status === "pending").length;
  const approvalApproved = approvalRows.filter((r) => r.status === "approved").length;
  const approvalRejected = approvalRows.filter((r) => r.status === "rejected").length;
  const approvalChanges = approvalRows.filter((r) => r.status === "changes_requested").length;

  // Authorisation stats
  const poPending = pos.filter((p) => p.status === "pending_approval").length;
  const poApproved = pos.filter((p) => p.status === "approved").length;
  const poRejected = pos.filter((p) => p.status === "rejected").length;
  const travelPending = travelReqs.filter((t) => t.status === "pending_approval").length;
  const travelApproved = travelReqs.filter((t) => t.status === "approved").length;
  const travelRejected = travelReqs.filter((t) => t.status === "rejected").length;
  const authTotal = pos.length + travelReqs.length;
  const authPending = poPending + travelPending;
  const authApproved = poApproved + travelApproved;
  const authRejected = poRejected + travelRejected;

  return (
    <>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />

        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Operations Hub</h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {section === "action"
                    ? "Approvals and authorisation requests awaiting your decision."
                    : section === "directory"
                    ? "Suppliers and operational directories."
                    : "Work items, repos, website analytics and sync activity."}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleSync("azure")}
                  disabled={syncing === "azure"}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {syncing === "azure" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync DevOps
                </button>
              </div>
            </div>
          </motion.div>

          {/* Primary section tabs */}
          <div className="mb-4 flex items-center gap-1 rounded-xl border border-border bg-card p-1 w-full sm:w-fit">
            {([
              { id: "overview", label: "Overview", badge: 0 },
              { id: "action", label: "Action", badge: pendingApprovals },
              { id: "directory", label: "Directory", badge: 0 },
            ] as const).map((s) => {
              const isActive = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveTab(sectionDefaults[s.id])}
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                  {s.badge && s.badge > 0 ? (
                    <span className="rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-semibold px-1.5 py-0.5 min-w-[18px] text-center">
                      {s.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>


          {/* Secondary sub-tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            {section === "overview" && (
              <TabsList className="bg-card border border-border w-full sm:w-auto overflow-x-auto flex-nowrap justify-start">
                <TabsTrigger value="work-items" className="gap-1.5 whitespace-nowrap">
                  <GitBranch className="h-3.5 w-3.5" /> Work Items
                </TabsTrigger>
                <TabsTrigger value="repos" className="gap-1.5 whitespace-nowrap">
                  <FolderGit2 className="h-3.5 w-3.5" /> Repos
                </TabsTrigger>
                <TabsTrigger value="analytics" className="gap-1.5 whitespace-nowrap">
                  <BarChart3 className="h-3.5 w-3.5" /> Website Analytics
                </TabsTrigger>
                <TabsTrigger value="sync-logs" className="gap-1.5 whitespace-nowrap">
                  <Clock className="h-3.5 w-3.5" /> Sync Logs
                </TabsTrigger>
              </TabsList>
            )}

            {section === "action" && (
              <TabsList className="bg-card border border-border w-full sm:w-auto overflow-x-auto flex-nowrap justify-start">
                <TabsTrigger value="approvals" className="gap-1.5 whitespace-nowrap">
                  <Inbox className="h-3.5 w-3.5" /> Approvals
                  {pendingApprovals > 0 && (
                    <span className="ml-1 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-semibold px-1.5 py-0.5 min-w-[18px] text-center">
                      {pendingApprovals}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="authorisation" className="gap-1.5 whitespace-nowrap">
                  <Receipt className="h-3.5 w-3.5" /> Authorisation Requests
                </TabsTrigger>
              </TabsList>
            )}

            {section === "directory" && (
              <TabsList className="bg-card border border-border w-full sm:w-auto overflow-x-auto flex-nowrap justify-start">
                <TabsTrigger value="suppliers" className="gap-1.5 whitespace-nowrap">
                  <Building2 className="h-3.5 w-3.5" /> Suppliers
                </TabsTrigger>
              </TabsList>
            )}

            {/* Work Items */}
            <TabsContent value="work-items" className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <GitBranch className="h-4 w-4 text-primary" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Active Items</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{activeItems}</p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-norman-warning" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Blocked</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{blockedItems}</p>
                </motion.div>
              </div>
              {wiLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : workItems.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <GitBranch className="h-8 w-8 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No work items synced yet. Connect Azure DevOps and run a sync.</p>
                </div>
              ) : (
                <>
                  {/* Filter bar */}
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search title or #ID…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="h-9 pl-8 text-xs"
                      />
                    </div>
                    <Select value={stateFilter} onValueChange={setStateFilter}>
                      <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue placeholder="State" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All states</SelectItem>
                        {filterOptions.states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {filterOptions.types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                      <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue placeholder="Assignee" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All assignees</SelectItem>
                        <SelectItem value="__unassigned__">Unassigned</SelectItem>
                        {filterOptions.assignees.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {filterOptions.projects.length > 0 && (
                      <Select value={projectFilter} onValueChange={setProjectFilter}>
                        <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue placeholder="All projects" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All projects</SelectItem>
                          {filterOptions.projects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Select value={releaseFilter} onValueChange={setReleaseFilter}>
                      <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue placeholder="All releases" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All releases</SelectItem>
                        <SelectItem value="__none__">No release</SelectItem>
                        {filterOptions.releases.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {hasActiveFilters && (
                      <button
                        onClick={clearFilters}
                        className="flex items-center gap-1 h-9 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      >
                        <X className="h-3.5 w-3.5" /> Clear
                      </button>
                    )}
                    <span className="ml-auto text-xs font-mono text-muted-foreground">
                      {filteredItems.length} of {workItems.length}
                    </span>
                  </div>

                  {filteredItems.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground rounded-xl border border-border bg-card">
                      <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No work items match these filters.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                      <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr className="border-b border-border bg-secondary/30">
                            <th className="text-left px-4 py-3 text-xs font-mono uppercase text-muted-foreground">ID</th>
                            <th className="text-left px-4 py-3 text-xs font-mono uppercase text-muted-foreground">Title</th>
                            <th className="text-left px-4 py-3 text-xs font-mono uppercase text-muted-foreground">State</th>
                            <th className="text-left px-4 py-3 text-xs font-mono uppercase text-muted-foreground">Type</th>
                            <th className="text-left px-4 py-3 text-xs font-mono uppercase text-muted-foreground">Assigned To</th>
                            <th className="text-left px-4 py-3 text-xs font-mono uppercase text-muted-foreground">Project</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredItems.map((item: any) => (
                            <tr key={item.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{item.external_id}</td>
                              <td className="px-4 py-3 font-medium text-foreground max-w-xs truncate">{item.title}</td>
                              <td className="px-4 py-3">
                                <Badge variant="outline" className={stateColors[item.state] || ""}>{item.state}</Badge>
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">{item.work_item_type}</td>
                              <td className="px-4 py-3 text-muted-foreground">{item.assigned_to || "—"}</td>
                              <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{item.project_name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Repos */}
            <TabsContent value="repos" className="space-y-4">
              {(reposLoading || reposListLoading || prsLoading) && !reposSummary ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : reposError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">Could not load Azure Repos.</p>
                      <p className="text-xs mt-1 opacity-80">{(reposError as Error).message}</p>
                    </div>
                    <button onClick={() => refetchRepos()} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-secondary">
                      Retry
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <FolderGit2 className="h-4 w-4 text-primary" />
                        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Repos</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{reposListResp?.count ?? reposSummary?.repos_total ?? 0}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <GitCommit className="h-4 w-4 text-primary" />
                        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Commits / 7d</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{reposSummary?.commits_total ?? 0}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <GitPullRequest className="h-4 w-4 text-primary" />
                        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Active PRs</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{activePRsResp?.count ?? reposSummary?.active_prs_total ?? 0}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Contributors</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{reposSummary ? Object.keys(reposSummary.commits_by_author).length : 0}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Commits by author */}
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <GitCommit className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold text-foreground">Commits by author (7d)</h3>
                      </div>
                      {reposSummary && Object.keys(reposSummary.commits_by_author).length > 0 ? (
                        <div className="space-y-2">
                          {Object.entries(reposSummary.commits_by_author)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .slice(0, 10)
                            .map(([author, count]) => (
                              <div key={author} className="flex justify-between text-sm">
                                <span className="text-foreground truncate">{author}</span>
                                <span className="font-mono text-muted-foreground">{count as number}</span>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No commits in the last 7 days.</p>
                      )}
                    </div>

                    {/* Commits by repo */}
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <FolderGit2 className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold text-foreground">Most active repos (7d)</h3>
                      </div>
                      {reposSummary && Object.keys(reposSummary.commits_by_repo).length > 0 ? (
                        <div className="space-y-2">
                          {Object.entries(reposSummary.commits_by_repo)
                            .filter(([, c]) => (c as number) > 0)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .slice(0, 10)
                            .map(([repo, count]) => (
                              <div key={repo} className="flex justify-between text-sm">
                                <span className="text-foreground truncate font-mono text-xs">{repo}</span>
                                <span className="font-mono text-muted-foreground">{count as number}</span>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No repo activity in the last 7 days.</p>
                      )}
                    </div>
                  </div>

                  {/* Active PRs */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <GitPullRequest className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-foreground">Active pull requests</h3>
                    </div>
                    {(activePRsResp?.pull_requests || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active pull requests.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b border-border">
                            <tr className="text-left text-xs font-mono uppercase tracking-wider text-muted-foreground">
                              <th className="px-3 py-2">PR</th>
                              <th className="px-3 py-2">Title</th>
                              <th className="px-3 py-2">Author</th>
                              <th className="px-3 py-2">Repo</th>
                              <th className="px-3 py-2">Reviewers</th>
                              <th className="px-3 py-2">Opened</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(activePRsResp?.pull_requests || []).slice(0, 25).map((pr: AzurePullRequest) => {
                              const approved = pr.reviewers.filter(r => r.vote >= 5).length;
                              const rejected = pr.reviewers.filter(r => r.vote <= -5).length;
                              return (
                                <tr key={pr.id} className="border-b border-border/50 hover:bg-secondary/30">
                                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">!{pr.id}</td>
                                  <td className="px-3 py-2 text-foreground max-w-md truncate">
                                    {pr.is_draft && <Badge variant="outline" className="mr-2 text-[10px]">draft</Badge>}
                                    {pr.title}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground text-xs">{pr.created_by}</td>
                                  <td className="px-3 py-2 text-muted-foreground text-xs font-mono">{pr.project}/{pr.repository}</td>
                                  <td className="px-3 py-2 text-xs">
                                    {approved > 0 && <span className="text-norman-success">✓{approved}</span>}
                                    {rejected > 0 && <span className="text-destructive ml-2">✗{rejected}</span>}
                                    {approved === 0 && rejected === 0 && <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground text-xs">
                                    {new Date(pr.creation_date).toLocaleDateString()}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Recent commits */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Activity className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-foreground">Recent commits</h3>
                    </div>
                    {(reposSummary?.recent_commits || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recent commits.</p>
                    ) : (
                      <div className="space-y-2">
                        {(reposSummary?.recent_commits || []).slice(0, 15).map((c, i) => (
                          <div key={`${c.date}-${i}`} className="flex items-start justify-between gap-3 text-sm border-b border-border/30 pb-2 last:border-0">
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground truncate">{c.message}</p>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                {c.project}/{c.repository} · {c.author}
                              </p>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {new Date(c.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="space-y-4">
              {analytics.isLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : !analytics.isConnected ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center">
                  <PlugZap className="h-9 w-9 mx-auto mb-3 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Google Analytics not connected</h3>
                  <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
                    {isAdmin
                      ? "Connect Duncan's GA4 account once — every team member will then see the same company-wide analytics."
                      : "Website analytics will appear here once an admin connects Duncan's GA4 account."}
                  </p>
                  {isAdmin && (
                    <button
                      onClick={() => analytics.initiateOAuth().catch((err: any) => toast.error(err.message || "Connection failed"))}
                      disabled={analytics.isConnecting}
                      className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      {analytics.isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                      Connect Google Analytics
                    </button>
                  )}
                </div>
              ) : analytics.dashboard ? (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: "Active users", value: analytics.dashboard.summary.activeUsers.toLocaleString(), icon: Users },
                      { label: "Sessions", value: analytics.dashboard.summary.sessions.toLocaleString(), icon: Activity },
                      { label: "Page views", value: analytics.dashboard.summary.pageViews.toLocaleString(), icon: MousePointerClick },
                      { label: "Engagement", value: `${Math.round(analytics.dashboard.summary.engagementRate * 100)}%`, icon: BarChart3 },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <item.icon className="h-4 w-4 text-primary" />
                          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{item.label}</span>
                        </div>
                        <p className="text-2xl font-bold text-foreground">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-4"><Globe2 className="h-4 w-4 text-primary" /><h3 className="font-semibold text-foreground">Highest reach</h3></div>
                      <div className="space-y-2">
                        {analytics.dashboard.reach.countries.map((country) => (
                          <div key={country.label} className="flex items-center justify-between text-sm">
                            <span className="text-foreground">{country.label}</span>
                            <span className="font-mono text-muted-foreground">{country.users.toLocaleString()} users</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-4"><MousePointerClick className="h-4 w-4 text-primary" /><h3 className="font-semibold text-foreground">Top pages</h3></div>
                      <div className="space-y-2">
                        {analytics.dashboard.topPages.map((page) => (
                          <div key={page.page} className="flex items-center justify-between gap-4 text-sm">
                            <span className="text-foreground truncate">{page.page}</span>
                            <span className="font-mono text-muted-foreground shrink-0">{page.views.toLocaleString()} views</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h3 className="font-semibold text-foreground mb-4">Cities</h3>
                      <div className="space-y-2">{analytics.dashboard.reach.cities.slice(0, 6).map((city) => <div key={city.label} className="flex justify-between text-sm"><span>{city.label}</span><span className="font-mono text-muted-foreground">{city.users}</span></div>)}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h3 className="font-semibold text-foreground mb-4">Devices</h3>
                      <div className="space-y-2">{analytics.dashboard.devices.map((device) => <div key={device.label} className="flex justify-between text-sm"><span className="capitalize">{device.label}</span><span className="font-mono text-muted-foreground">{device.users}</span></div>)}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h3 className="font-semibold text-foreground mb-4">Demographics</h3>
                      {analytics.dashboard.demographics.available ? (
                        <div className="space-y-2">{analytics.dashboard.demographics.rows.slice(0, 6).map((row) => <div key={`${row.age}-${row.gender}`} className="flex justify-between text-sm"><span>{row.age} · {row.gender}</span><span className="font-mono text-muted-foreground">{row.users}</span></div>)}</div>
                      ) : <p className="text-sm text-muted-foreground">Demographics are not available for this GA4 property yet.</p>}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="font-semibold text-foreground mb-3">Ask Duncan about website reach</h3>
                    <div className="flex gap-2">
                      <Input value={analyticsQuestion} onChange={(e) => setAnalyticsQuestion(e.target.value)} placeholder="Where do we have the most reach?" />
                      <button onClick={handleAskAnalytics} disabled={analytics.isAsking} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50">
                        {analytics.isAsking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                    {analyticsAnswer && <div className="mt-4 rounded-lg bg-secondary/40 p-4 text-sm text-foreground whitespace-pre-wrap">{analyticsAnswer}</div>}
                  </div>
                </>
              ) : null}
            </TabsContent>

            {/* Sync Logs */}
            <TabsContent value="sync-logs">
              {slLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : syncLogs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No sync activity yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {syncLogs.map((log: any) => (
                    <div key={log.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-2 w-2 rounded-full ${log.status === "completed" ? "bg-norman-success" : log.status === "failed" ? "bg-destructive" : "bg-norman-warning animate-pulse"}`} />
                        <div>
                          <p className="text-sm font-medium text-foreground">{log.integration} — {log.sync_type}</p>
                          <p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline" className={log.status === "completed" ? "bg-norman-success/10 text-norman-success" : log.status === "failed" ? "bg-destructive/10 text-destructive" : ""}>
                          {log.status}
                        </Badge>
                        {log.records_synced > 0 && (
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">{log.records_synced} records</p>
                        )}
                        {log.error_message && (
                          <p className="text-xs text-destructive mt-0.5 max-w-xs truncate">{log.error_message}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="approvals" className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-norman-warning" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Pending</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{approvalPending}</p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="h-4 w-4 text-norman-success" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Approved</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{approvalApproved}</p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Rejected</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{approvalRejected}</p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarClock className="h-4 w-4 text-sky-500" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Changes Requested</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{approvalChanges}</p>
                </motion.div>
              </div>
              <div className="-mx-4 sm:-mx-8 -mt-2 [&_main]:!overflow-visible [&_main]:!flex-none [&_.gradient-radial]:!hidden">
                <Approvals />
              </div>
            </TabsContent>

            <TabsContent value="authorisation" className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Receipt className="h-4 w-4 text-primary" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Total Requests</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{authTotal}</p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-norman-warning" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Pending</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{authPending}</p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-norman-success" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Approved</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{authApproved}</p>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Rejected</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{authRejected}</p>
                </motion.div>
              </div>
              <div className="-mx-4 sm:-mx-8 -mt-2 [&_main]:!overflow-visible [&_main]:!flex-none [&_.gradient-radial]:!hidden">
                <PurchaseOrders />
              </div>
            </TabsContent>

            <TabsContent value="suppliers">
              <SuppliersDirectory />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </>
  );
};

export default Operations;
