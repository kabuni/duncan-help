import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Mail } from "lucide-react";

interface Rsvp {
  id: string;
  email: string;
  display_name: string | null;
  status: "yes" | "no" | "maybe";
  source: string;
  responded_at: string;
}

const statusColor: Record<string, string> = {
  yes: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  no: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  maybe: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
};

export function EventRsvps({ eventId }: { eventId: string }) {
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("event_rsvps" as any)
        .select("id,email,display_name,status,source,responded_at")
        .eq("event_id", eventId)
        .order("responded_at", { ascending: false });
      if (mounted) {
        setRsvps((data as any) || []);
        setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`rsvps-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_rsvps", filter: `event_id=eq.${eventId}` },
        async () => {
          const { data } = await supabase
            .from("event_rsvps" as any)
            .select("id,email,display_name,status,source,responded_at")
            .eq("event_id", eventId)
            .order("responded_at", { ascending: false });
          setRsvps((data as any) || []);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  if (loading) return null;

  const counts = rsvps.reduce(
    (a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }),
    {} as Record<string, number>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs text-muted-foreground">
          Attendees (RSVPs){rsvps.length > 0 && ` · ${counts.yes || 0} yes · ${counts.maybe || 0} maybe · ${counts.no || 0} no`}
        </div>
      </div>
      {rsvps.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
          No RSVPs yet. Teammates can email <span className="font-mono">duncan@kabuni.com</span> to RSVP.
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rsvps.map((r) => (
            <li
              key={r.id}
              className={`inline-flex items-center gap-1.5 border rounded-md px-2 py-1 text-xs ${statusColor[r.status] || ""}`}
              title={`${r.email} · via ${r.source}`}
            >
              <span>{r.display_name || r.email}</span>
              <Badge variant="outline" className="text-[10px] capitalize bg-background/40">
                {r.status}
              </Badge>
              {r.source === "email" && <Mail className="h-3 w-3 opacity-60" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
