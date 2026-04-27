import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranch, AlertTriangle,
  Clock, RefreshCw, Loader2, Activity, Search, X,
  BarChart3, Globe2, Users, MousePointerClick, PlugZap, Send,
  GitPullRequest, GitCommit, FolderGit2,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fastApi, withFastApi } from "@/lib/fastApiClient";
import { useGoogleAnalytics } from "@/hooks/useGoogleAnalytics";
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

const Operations = () => {
  const { data: workItems = [], isLoading: wiLoading } = useWorkItems();
  const { data: syncLogs = [], isLoading: slLoading } = useSyncLogs();
  const analytics = useGoogleAnalytics();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [analyticsQuestion, setAnalyticsQuestion] = useState("Where do we have the most website reach?");
  const [analyticsAnswer, setAnalyticsAnswer] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  // Unique filter options
  const filterOptions = useMemo(() => {
    const states = new Set<string>();
    const types = new Set<string>();
    const assignees = new Set<string>();
    const projects = new Set<string>();
    workItems.forEach((w: any) => {
      if (w.state) states.add(w.state);
      if (w.work_item_type) types.add(w.work_item_type);
      if (w.assigned_to) assignees.add(w.assigned_to);
      if (w.project_name) projects.add(w.project_name);
    });
    return {
      states: Array.from(states).sort(),
      types: Array.from(types).sort(),
      assignees: Array.from(assignees).sort(),
      projects: Array.from(projects).sort(),
    };
  }, [workItems]);

  const filteredItems = useMemo(() => {
    return workItems.filter((w: any) => {
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
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!w.title?.toLowerCase().includes(q) && !String(w.external_id).includes(q)) return false;
      }
      return true;
    });
  }, [workItems, stateFilter, typeFilter, assigneeFilter, projectFilter, searchQuery]);

  const hasActiveFilters = stateFilter !== "all" || typeFilter !== "all" || assigneeFilter !== "all" || projectFilter !== "all" || searchQuery !== "";
  const clearFilters = () => {
    setStateFilter("all"); setTypeFilter("all"); setAssigneeFilter("all"); setProjectFilter("all"); setSearchQuery("");
  };

  const handleSync = async (type: "azure") => {
    setSyncing(type);
    try {
      await withFastApi(
        async () => {
          const { error } = await supabase.functions.invoke("sync-azure-work-items");
          if (error) throw error;
          return null;
        },
        () => fastApi("POST", "/sync/azure-work-items", {}),
      );
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

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />

        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Operations Hub</h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Cross-system view of Azure DevOps work items.
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

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 mb-8">
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

          {/* Tabs */}
          <Tabs defaultValue="work-items" className="space-y-4">
            <TabsList className="bg-card border border-border w-full sm:w-auto overflow-x-auto flex-nowrap justify-start">
              <TabsTrigger value="work-items" className="gap-1.5 whitespace-nowrap">
                <GitBranch className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Work Items</span><span className="sm:hidden">Items</span>
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5 whitespace-nowrap">
                <BarChart3 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Website Analytics</span><span className="sm:hidden">Analytics</span>
              </TabsTrigger>
              <TabsTrigger value="sync-logs" className="gap-1.5 whitespace-nowrap">
                <Clock className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sync Logs</span><span className="sm:hidden">Logs</span>
              </TabsTrigger>
            </TabsList>

            {/* Work Items */}
            <TabsContent value="work-items" className="space-y-3">
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

            <TabsContent value="analytics" className="space-y-4">
              {analytics.isLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : !analytics.isConnected ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center">
                  <PlugZap className="h-9 w-9 mx-auto mb-3 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Connect Google Analytics</h3>
                  <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
                    Connect GA4 so Duncan can report traffic, reach, demographics, and answer questions about website performance.
                  </p>
                  <button
                    onClick={() => analytics.initiateOAuth().catch((err: any) => toast.error(err.message || "Connection failed"))}
                    disabled={analytics.isConnecting}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                  >
                    {analytics.isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                    Connect Google Analytics
                  </button>
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
          </Tabs>
        </div>
      </main>
    </AppLayout>
  );
};

export default Operations;
