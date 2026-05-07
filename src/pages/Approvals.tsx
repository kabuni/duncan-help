import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Clock, ShieldCheck, XCircle, CalendarClock, ExternalLink, Inbox, Filter } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApprovals, useDecideApproval, type ApprovalRow, type ApprovalKind } from "@/hooks/useApprovals";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  changes_requested: "bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-400",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const STATUS_ICON: Record<string, any> = {
  pending: Clock,
  approved: ShieldCheck,
  rejected: XCircle,
  changes_requested: CalendarClock,
  cancelled: X,
};

const KIND_LABEL: Record<ApprovalKind, string> = {
  cost: "Cost",
  event_date: "Event date",
  release: "Release",
  hire: "Hire",
  contract: "Contract",
  other: "Other",
};

function fmtAmount(amount: number | null, currency: string | null) {
  if (amount == null) return null;
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  return `${sym}${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Approvals() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useApprovals();
  const decide = useDecideApproval();

  const [tab, setTab] = useState<"mine" | "requested" | "all">("mine");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tab === "mine" && r.approver_user_id !== user?.id) return false;
      if (tab === "requested" && r.requested_by !== user?.id) return false;
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, tab, kindFilter, search, user]);

  const grouped = useMemo(() => {
    const pending = filtered.filter((r) => r.status === "pending");
    const decided = filtered.filter((r) => r.status !== "pending");
    return { pending, decided };
  }, [filtered]);

  const myPendingCount = rows.filter((r) => r.status === "pending" && r.approver_user_id === user?.id).length;

  const renderRow = (r: ApprovalRow) => {
    const Icon = STATUS_ICON[r.status] || Clock;
    const amount = fmtAmount(r.amount, r.currency);
    const isApprover = r.approver_user_id === user?.id;
    const isRejecting = rejectingId === r.id;

    return (
      <motion.div
        key={r.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <Card className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase font-mono">
                  {KIND_LABEL[r.kind]}
                </Badge>
                {amount && <span className="text-sm font-semibold text-foreground">{amount}</span>}
                <Badge
                  className={cn(
                    "border text-[10px] inline-flex items-center gap-1",
                    STATUS_TONE[r.status]
                  )}
                >
                  <Icon className="h-3 w-3" /> {r.status.replace("_", " ")}
                </Badge>
                {r.due_at && (
                  <span className="text-[11px] text-muted-foreground">
                    Due {format(new Date(r.due_at), "dd MMM")}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground mt-1 truncate">{r.title}</p>
              {r.summary && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.summary}</p>
              )}
              {r.decision_note && r.status !== "pending" && (
                <p className="text-[11px] italic text-muted-foreground mt-1">
                  Note: {r.decision_note}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {r.link_path && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => navigate(r.link_path!)}
                  title="Open source"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              {isApprover && r.status === "pending" && !isRejecting && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() => decide.mutate({ row: r, status: "approved" })}
                    disabled={decide.isPending}
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => {
                      setRejectingId(r.id);
                      setRejectNote("");
                    }}
                    disabled={decide.isPending}
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                </>
              )}
            </div>
          </div>

          {isRejecting && (
            <div className="mt-2 flex gap-2 items-center border-t border-border pt-2">
              <Input
                placeholder="Reason (required)"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                className="h-8 text-xs flex-1"
                autoFocus
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => {
                  setRejectingId(null);
                  setRejectNote("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={!rejectNote.trim() || decide.isPending}
                onClick={async () => {
                  await decide.mutateAsync({ row: r, status: "rejected", note: rejectNote.trim() });
                  setRejectingId(null);
                  setRejectNote("");
                }}
              >
                Confirm reject
              </Button>
            </div>
          )}
        </Card>
      </motion.div>
    );
  };

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />
        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
          <div className="mb-6">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
              Inbox
            </p>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight flex items-center gap-3">
              Approvals
              {myPendingCount > 0 && (
                <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 border">
                  {myPendingCount} awaiting you
                </Badge>
              )}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              One place for every sign-off — costs, event dates, releases. Decisions write back to the source.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full sm:w-auto">
              <TabsList className="bg-secondary/50">
                <TabsTrigger value="mine">For me</TabsTrigger>
                <TabsTrigger value="requested">Requested by me</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex gap-2 flex-1">
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger className="h-9 text-xs w-40">
                  <Filter className="h-3.5 w-3.5 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All kinds</SelectItem>
                  <SelectItem value="cost">Costs</SelectItem>
                  <SelectItem value="event_date">Event dates</SelectItem>
                  <SelectItem value="release">Releases</SelectItem>
                  <SelectItem value="hire">Hires</SelectItem>
                  <SelectItem value="contract">Contracts</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 text-xs flex-1"
              />
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground italic">Loading…</p>
          ) : filtered.length === 0 ? (
            <Card className="border-dashed">
              <div className="py-12 text-center">
                <Inbox className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Nothing to see here.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-6">
              {grouped.pending.length > 0 && (
                <section>
                  <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                    Pending ({grouped.pending.length})
                  </h3>
                  <div className="space-y-2">{grouped.pending.map(renderRow)}</div>
                </section>
              )}
              {grouped.decided.length > 0 && (
                <section>
                  <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                    Decided ({grouped.decided.length})
                  </h3>
                  <div className="space-y-2">{grouped.decided.map(renderRow)}</div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
