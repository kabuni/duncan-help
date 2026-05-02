import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Check, ShieldCheck, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const APPROVAL_TYPES = [
  "Design",
  "Legal",
  "Finance",
  "Marketing",
  "Operations",
  "Product",
  "Launch",
  "Investor",
  "Travel",
  "Releases",
  "Event",
  "Holiday",
  "Other",
];

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
};

const STATUS_ICON: Record<string, any> = { pending: Clock, approved: ShieldCheck, rejected: XCircle };

interface ApprovalRow {
  id: string;
  approval_type: string;
  label: string | null;
  approver_profile_id: string | null;
  requested_by: string;
  status: "pending" | "approved" | "rejected";
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

interface ProfileLite {
  id: string;
  user_id: string;
  display_name: string | null;
}

export function EventApprovals({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<string>("Design");
  const [label, setLabel] = useState("");
  const [approverId, setApproverId] = useState<string>("none");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [{ data: u }, { data: r }, { data: p }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("key_event_approvals" as any).select("*").eq("event_id", eventId).order("created_at"),
      supabase.from("profiles").select("id, user_id, display_name").eq("approval_status", "approved"),
    ]);
    const uid = u.user?.id || null;
    setCurrentUserId(uid);
    setProfiles((p as any[]) || []);
    setCurrentProfileId(((p as any[]) || []).find((x) => x.user_id === uid)?.id || null);
    setRows((r as any[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  function nameForProfile(pid: string | null) {
    if (!pid) return "Unassigned";
    return profiles.find((p) => p.id === pid)?.display_name || "Unknown";
  }

  async function addApproval() {
    if (!currentUserId) return;
    setAdding(true);
    const { error } = await supabase.from("key_event_approvals" as any).insert({
      event_id: eventId,
      approval_type: type,
      label: label.trim() || null,
      approver_profile_id: approverId === "none" ? null : approverId,
      requested_by: currentUserId,
    });
    setAdding(false);
    if (error) return toast.error(error.message);
    setLabel("");
    setApproverId("none");
    setType("Design");
    toast.success("Approval requested");
    load();
  }

  async function setStatus(row: ApprovalRow, status: "approved" | "rejected" | "pending") {
    setBusyId(row.id);
    const { error } = await supabase
      .from("key_event_approvals" as any)
      .update({
        status,
        decided_at: status === "pending" ? null : new Date().toISOString(),
      })
      .eq("id", row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    load();
  }

  async function remove(row: ApprovalRow) {
    setBusyId(row.id);
    const { error } = await supabase.from("key_event_approvals" as any).delete().eq("id", row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs text-muted-foreground">Approvals</div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic mb-2">No approvals requested</p>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {rows.map((row) => {
            const Icon = STATUS_ICON[row.status] || Clock;
            const isApprover = currentProfileId && row.approver_profile_id === currentProfileId;
            const isRequester = currentUserId === row.requested_by;
            return (
              <li key={row.id} className="border border-border rounded-md px-2 py-1.5 text-xs space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">{row.approval_type}</Badge>
                  {row.label && <span className="text-foreground truncate">{row.label}</span>}
                  <Badge className={cn("border text-[10px] ml-auto inline-flex items-center gap-1", STATUS_TONE[row.status])}>
                    <Icon className="h-3 w-3" /> {row.status}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="truncate">Approver: <span className="text-foreground">{nameForProfile(row.approver_profile_id)}</span></span>
                  <div className="flex items-center gap-1 shrink-0">
                    {isApprover && row.status !== "approved" && (
                      <button
                        onClick={() => setStatus(row, "approved")}
                        disabled={busyId === row.id}
                        className="text-emerald-600 hover:bg-emerald-500/10 rounded p-1"
                        title="Approve"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                    {isApprover && row.status !== "rejected" && (
                      <button
                        onClick={() => setStatus(row, "rejected")}
                        disabled={busyId === row.id}
                        className="text-destructive hover:bg-destructive/10 rounded p-1"
                        title="Reject"
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    )}
                    {isRequester && (
                      <button
                        onClick={() => remove(row)}
                        disabled={busyId === row.id}
                        className="text-muted-foreground hover:text-destructive rounded p-1"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border border-dashed border-border rounded-md p-2 space-y-1.5">
        <div className="flex gap-1.5">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {APPROVAL_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={approverId} onValueChange={setApproverId}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Approver" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">No approver yet</SelectItem>
              {profiles
                .slice()
                .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""))
                .map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">{p.display_name || "Unnamed"}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1.5">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional note (e.g. 'Hero banner v2')"
            className="h-7 text-xs flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={addApproval}
            disabled={adding || !currentUserId}
          >
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}
