import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Trash2, Users, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  days_inactive: number;
  display_name: string | null;
  department: string | null;
  role_title: string | null;
  approval_status: string | null;
}

export default function AdminUserManagement() {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "inactive30" | "inactive60" | "test" | "never">("all");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "list" },
      });
      if (error) throw error;
      return (data?.users ?? []) as AdminUser[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "delete", userIds },
      });
      if (error) throw error;
      return data as { deleted: number; failed: { id: string; error: string }[] };
    },
    onSuccess: (res) => {
      toast.success(`Deleted ${res.deleted} user${res.deleted === 1 ? "" : "s"}`);
      if (res.failed?.length) {
        toast.error(`${res.failed.length} failed: ${res.failed[0].error}`);
      }
      setSelected(new Set());
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["pending-approvals"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const filtered = useMemo(() => {
    const testPatterns = ["example.com", "example.invalid", "pentest", "cors-check", "test-proxy"];
    return users.filter((u) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !u.email?.toLowerCase().includes(q) &&
          !u.display_name?.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (filter === "inactive30") return u.days_inactive >= 30;
      if (filter === "inactive60") return u.days_inactive >= 60;
      if (filter === "never") return !u.last_sign_in_at;
      if (filter === "test") {
        return testPatterns.some((p) => u.email?.toLowerCase().includes(p));
      }
      return true;
    });
  }, [users, search, filter]);

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((u) => u.id).filter((id) => id !== currentUser?.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filters: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: users.length },
    { key: "inactive30", label: "Inactive 30d+", count: users.filter((u) => u.days_inactive >= 30).length },
    { key: "inactive60", label: "Inactive 60d+", count: users.filter((u) => u.days_inactive >= 60).length },
    { key: "never", label: "Never signed in", count: users.filter((u) => !u.last_sign_in_at).length },
    {
      key: "test",
      label: "Test/probe",
      count: users.filter((u) =>
        ["example.com", "example.invalid", "pentest", "cors-check", "test-proxy"].some((p) =>
          u.email?.toLowerCase().includes(p),
        ),
      ).length,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <button
          disabled={selected.size === 0 || deleteMutation.isPending}
          onClick={() => setConfirmOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Delete {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium border transition-colors ${
              filter === f.key
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label} <span className="opacity-60">· {f.count}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-[32px_1fr_1fr_90px_90px] gap-2 px-3 py-2 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
          <Checkbox
            checked={filtered.length > 0 && selected.size >= filtered.filter((u) => u.id !== currentUser?.id).length}
            onCheckedChange={toggleAll}
          />
          <div>User</div>
          <div>Department / Role</div>
          <div>Last sign in</div>
          <div>Status</div>
        </div>
        <div className="max-h-[480px] overflow-y-auto divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No users match</p>
            </div>
          ) : (
            filtered.map((u) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <div
                  key={u.id}
                  className={`grid grid-cols-[32px_1fr_1fr_90px_90px] gap-2 px-3 py-2.5 items-center text-xs hover:bg-muted/20 ${
                    selected.has(u.id) ? "bg-primary/5" : ""
                  }`}
                >
                  <Checkbox
                    checked={selected.has(u.id)}
                    onCheckedChange={() => toggleOne(u.id)}
                    disabled={isSelf}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {u.display_name || "—"} {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-muted-foreground truncate text-[11px]">{u.email}</p>
                  </div>
                  <div className="min-w-0 text-muted-foreground truncate">
                    {u.department || "—"}
                    {u.role_title ? ` · ${u.role_title}` : ""}
                  </div>
                  <div
                    className={`text-[11px] ${
                      u.days_inactive >= 60
                        ? "text-destructive"
                        : u.days_inactive >= 30
                          ? "text-amber-600"
                          : "text-muted-foreground"
                    }`}
                  >
                    {u.last_sign_in_at ? `${u.days_inactive}d ago` : "Never"}
                  </div>
                  <div>
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        u.approval_status === "approved"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : u.approval_status === "rejected"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {u.approval_status ?? "—"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Delete {selected.size} user{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected accounts from Duncan, including their profile,
              sessions, and access. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(Array.from(selected))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
