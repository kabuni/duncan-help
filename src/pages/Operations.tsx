import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranch, AlertTriangle,
  Clock, RefreshCw, Loader2, Activity, Search, X,
  BarChart3, Globe2, Users, MousePointerClick, PlugZap, Send,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fastApi, withFastApi } from "@/lib/fastApiClient";
import { useGoogleAnalytics } from "@/hooks/useGoogleAnalytics";
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
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground tracking-tight">Operations Hub</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Cross-system view of Azure DevOps work items.
                </p>
              </div>
              <div className="flex items-center gap-2">
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
            <TabsList className="bg-card border border-border">
              <TabsTrigger value="work-items" className="gap-1.5">
                <GitBranch className="h-3.5 w-3.5" /> Work Items
              </TabsTrigger>
              <TabsTrigger value="sync-logs" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Sync Logs
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
                      <table className="w-full text-sm">
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
                  )}
                </>
              )}
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
