import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Plus, Search, Filter, LayoutGrid, List, Loader2,
  AlertTriangle, Clock, User, CheckCircle2, Target,
  CalendarDays, ArrowUpDown,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useWorkstreamCards, useUserProfiles, type WorkstreamCard, type CardStatus } from "@/hooks/useWorkstreams";
import { useAuth } from "@/hooks/useAuth";
import { isPast, isThisWeek } from "date-fns";
import KanbanBoard from "@/components/workstreams/KanbanBoard";
import CardDetailModal from "@/components/workstreams/CardDetailModal";
import CreateCardDialog from "@/components/workstreams/CreateCardDialog";
import { StatusBadge, priorityConfig, getStatusBorderClass } from "@/components/workstreams/StatusBadge";
import { format } from "date-fns";

type ViewMode = "board" | "list";

const Workstreams = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority] = useState<string>("all");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [prefillTag, setPrefillTag] = useState<string | undefined>(undefined);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Auto-open Create dialog when navigated from CEO Coverage Gap
  useEffect(() => {
    const tag = searchParams.get("prefill_tag");
    if (tag) {
      setPrefillTag(tag);
      setShowCreate(true);
      // clear params so reopening the dialog later doesn't auto-fill
      const next = new URLSearchParams(searchParams);
      next.delete("prefill_tag");
      next.delete("prefill_priority");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data: users } = useUserProfiles();

  const filters = useMemo(() => ({
    status: filterStatus !== "all" ? filterStatus as CardStatus : undefined,
    priority: filterPriority !== "all" ? filterPriority as import("@/hooks/useWorkstreams").CardPriority : undefined,
    assignee: filterAssignee !== "all" ? filterAssignee : undefined,
    search: search || undefined,
  }), [filterStatus, filterPriority, filterAssignee, search]);

  const { data: cards, isLoading } = useWorkstreamCards(filters.status || filters.priority || filters.assignee || filters.search ? filters : undefined);

  // For dashboard: fetch ALL cards (unfiltered) separately for stats
  const { data: allCards } = useWorkstreamCards();

  // Global progress overview (ignores filters; uses all cards)
  const overview = useMemo(() => {
    const c = allCards || [];
    const totalCards = c.length;
    const taskTotals = { red: 0, yellow: 0, green: 0, done: 0 };
    const cardCounts = { red: 0, yellow: 0, green: 0, done: 0 };
    let totalTasks = 0;

    for (const card of c) {
      const tb = card.task_breakdown || { red: 0, yellow: 0, green: 0, done: 0 };
      taskTotals.red += tb.red;
      taskTotals.yellow += tb.yellow;
      taskTotals.green += tb.green;
      taskTotals.done += tb.done;
      totalTasks += tb.red + tb.yellow + tb.green + tb.done;
      if (tb.red > 0) cardCounts.red++;
      if (tb.yellow > 0) cardCounts.yellow++;
      if (tb.green > 0) cardCounts.green++;
      if (tb.done > 0) cardCounts.done++;
    }

    const doneTasks = taskTotals.done;
    const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    return { totalCards, totalTasks, doneTasks, completionPct, taskTotals, cardCounts };
  }, [allCards]);

  const displayCards = cards || [];

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />

        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px]">
          {/* Header */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <Target className="h-5 w-5 text-primary" />
                <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Workstreams</h2>
              </div>
              <p className="text-xs text-muted-foreground font-mono">Track projects, tasks, and team progress</p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2 w-full sm:w-auto">
              <Plus className="h-4 w-4" /> New Card
            </Button>
          </motion.div>

          {/* Global progress overview */}
          <ProgressOverview overview={overview} />

          {/* Filters + view toggle */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6"
          >
            <div className="relative flex-1 w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search cards…"
                className="pl-9 h-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 w-[110px] text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="red">🔴 Red</SelectItem>
                  <SelectItem value="amber">🟡 Yellow</SelectItem>
                  <SelectItem value="green">🟢 Green</SelectItem>
                  <SelectItem value="done">✅ Done</SelectItem>
                </SelectContent>
              </Select>



              <Select value={filterAssignee} onValueChange={setFilterAssignee}>
                <SelectTrigger className="h-9 w-[130px] text-xs">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assignees</SelectItem>
                  {(users || []).map(u => (
                    <SelectItem key={u.user_id} value={u.user_id}>{u.display_name || "Unnamed"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* View toggle */}
              <div className="flex items-center bg-secondary/50 rounded-lg p-0.5 ml-auto">
                <button
                  onClick={() => setViewMode("board")}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                    viewMode === "board" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" /> Board
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                    viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <List className="h-3.5 w-3.5" /> List
                </button>
              </div>
            </div>
          </motion.div>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : displayCards.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16">
              <Target className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground mb-4">No workstream cards yet</p>
              <Button onClick={() => setShowCreate(true)} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Create your first card
              </Button>
            </motion.div>
          ) : viewMode === "board" ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <KanbanBoard cards={displayCards} onCardClick={card => setSelectedCardId(card.id)} />
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <ListView cards={displayCards} onCardClick={card => setSelectedCardId(card.id)} />
            </motion.div>
          )}
        </div>

        {/* Modals */}
        <CreateCardDialog
          open={showCreate}
          onOpenChange={(v) => { setShowCreate(v); if (!v) setPrefillTag(undefined); }}
          prefillTag={prefillTag}
        />
        <CardDetailModal cardId={selectedCardId} onClose={() => setSelectedCardId(null)} />
      </main>
    </AppLayout>
  );
};

function StatCard({ label, value, icon, valueColor }: {
  label: string; value: number; icon: React.ReactNode; valueColor?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-3 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">{icon}</div>
      <span className={`text-lg font-bold ${valueColor || "text-foreground"}`}>{value}</span>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function ListView({ cards, onCardClick }: { cards: WorkstreamCard[]; onCardClick: (card: WorkstreamCard) => void }) {
  return (
    <div className="space-y-2">
      {cards.map(card => {
        const isOverdue = card.due_date && isPast(new Date(card.due_date)) && card.status !== "done";
        return (
          <div
            key={card.id}
            onClick={() => onCardClick(card)}
            className={`cursor-pointer rounded-lg border border-l-[3px] bg-card p-4 transition-all hover:shadow-md hover:border-primary/30 flex items-center gap-4 ${getStatusBorderClass(card.status)}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-semibold text-foreground truncate">{card.title}</h4>
                <StatusBadge status={card.status} />
              </div>
              {card.description && (
                <p className="text-xs text-muted-foreground truncate max-w-md">{card.description}</p>
              )}
            </div>

            <div className="flex items-center gap-4 shrink-0">
              {card.tasks_total! > 0 && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {card.tasks_completed}/{card.tasks_total}
                </span>
              )}
              {(card.assignees || []).length > 0 ? (
                <div className="flex items-center gap-1">
                  {card.assignees!.slice(0, 3).map(a => (
                    <Badge key={a.user_id} variant="secondary" className="text-[9px] py-0 px-1">
                      {(a.display_name || "?").split(" ")[0]}
                    </Badge>
                  ))}
                  {card.assignees!.length > 3 && (
                    <span className="text-[9px] text-muted-foreground">+{card.assignees!.length - 3}</span>
                  )}
                </div>
              ) : card.owner_name ? (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> {card.owner_name.split(" ")[0]}
                </span>
              ) : null}
              {card.due_date && (
                <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                  <CalendarDays className="h-3 w-3" /> {format(new Date(card.due_date), "MMM d")}
                </span>
              )}
              {card.project_tag && (
                <span className="text-[9px] font-mono bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                  {card.project_tag}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Workstreams;
