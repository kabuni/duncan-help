import { format } from "date-fns";
import { Plane, Train, Car, MapPin, Calendar, X, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTravelRequests, useCancelTravelRequest, type TravelRequest } from "@/hooks/useTravelRequests";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  pending_approval: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const TRANSPORT_ICON: Record<string, any> = {
  flight: Plane, train: Train, car: Car, other: MapPin,
};

export default function TravelList({ scope = "mine" }: { scope?: "mine" | "approver" | "all" }) {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = useTravelRequests();
  const cancel = useCancelTravelRequest();

  const filtered = rows.filter((r) => {
    if (scope === "mine") return r.requester_id === user?.id;
    if (scope === "approver") return r.approver_user_id === user?.id && r.status === "pending_approval";
    return true;
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (filtered.length === 0) {
    return (
      <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
        {scope === "approver" ? "No travel requests waiting on you." : "No travel requests yet."}
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {filtered.map((r: TravelRequest) => {
        const Icon = TRANSPORT_ICON[r.transport_mode] || Plane;
        return (
          <Card key={r.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <Icon className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground">{r.reference}</span>
                  <span className="text-sm font-medium">{r.traveller_name}</span>
                  <Badge className={cn("border text-[10px] capitalize", STATUS_TONE[r.status])}>
                    {r.status.replace("_", " ")}
                  </Badge>
                </div>
                <p className="text-sm mt-0.5 text-foreground">
                  {r.destination_city}, {r.destination_country}
                </p>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(r.depart_date), "dd MMM")} – {format(new Date(r.return_date), "dd MMM yyyy")}
                  </span>
                  <span>£{Number(r.estimated_cost).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                  {r.accommodation_needed && <span>+ accommodation</span>}
                </div>
                {r.purpose && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.purpose}</p>}
                {r.rejection_reason && r.status === "rejected" && (
                  <p className="text-[11px] italic text-muted-foreground mt-1">Reason: {r.rejection_reason}</p>
                )}
              </div>
              {r.requester_id === user?.id && r.status === "pending_approval" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    if (confirm("Delete this travel request?")) cancel.mutate(r.id);
                  }}
                  title="Delete"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
