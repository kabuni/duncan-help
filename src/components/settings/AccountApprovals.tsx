import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Check, X, Loader2, Clock, UserCheck } from "lucide-react";
import { toast } from "sonner";

interface PendingUser {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

export default function AccountApprovals() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["pending-approvals"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await apiClient.get<PendingUser[]>("/auth/admin/pending-users");
      return data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: "approved" | "rejected" }) => {
      if (status === "approved") {
        await apiClient.post(`/auth/admin/approve/${userId}`);
      } else {
        await apiClient.post(`/auth/admin/reject/${userId}`);
      }
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
      toast.success(status === "approved" ? "Account approved" : "Account rejected");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (adminLoading || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      {users.length === 0 ? (
        <div className="text-center py-8">
          <UserCheck className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No pending approvals</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Pending ({users.length})
          </p>
          {users.map((u) => (
            <ApprovalCard
              key={u.id}
              user={u}
              onAction={approveMutation.mutate}
              isPending={approveMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  user,
  onAction,
  isPending,
}: {
  user: PendingUser;
  onAction: (args: { userId: string; status: "approved" | "rejected" }) => void;
  isPending: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{user.full_name || "Unnamed"}</p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        <p className="text-[10px] text-muted-foreground/50 mt-1">
          {new Date(user.created_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          disabled={isPending}
          onClick={() => onAction({ userId: user.id, status: "approved" })}
          className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          Approve
        </button>
        <button
          disabled={isPending}
          onClick={() => onAction({ userId: user.id, status: "rejected" })}
          className="flex items-center gap-1 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}
