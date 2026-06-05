import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Phone, MapPin, Building2, ChevronDown, ChevronUp, Users, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface RsvpRow {
  id: string;
  email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  organisation_type: string | null;
  organisation_name: string | null;
  state: string | null;
  status: "yes" | "no" | "maybe";
  source: string;
  responded_at: string;
  notes: string | null;
}

interface AttendeeExtract {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  organisation_type?: string | null;
  organisation_name?: string | null;
  location?: string | null;
}

interface DisplayAttendee {
  key: string;
  rsvpId: string;
  isPrimary: boolean;
  status: "yes" | "no" | "maybe";
  source: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  organisation_type: string | null;
  organisation_name: string | null;
  state: string | null; // city/region/location
}

const statusColor: Record<string, string> = {
  yes: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  no: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  maybe: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
};

const orgLabel: Record<string, string> = {
  school: "School",
  media: "Media",
  company: "Company",
  other: "Other",
};

const FIELDS = ["first_name", "last_name", "phone", "organisation_name", "state"] as const;
const ATTENDEES_MARKER = "\n\n--ATTENDEES_JSON--\n";

function parseSidecarAttendees(notes: string | null | undefined): AttendeeExtract[] {
  if (!notes) return [];
  const idx = notes.indexOf(ATTENDEES_MARKER);
  if (idx === -1) return [];
  try {
    const parsed = JSON.parse(notes.slice(idx + ATTENDEES_MARKER.length).trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normName(a: AttendeeExtract): string {
  return `${(a.first_name || "").trim()} ${(a.last_name || "").trim()}`.trim().toLowerCase();
}

function displayName(a: { first_name: string | null; last_name: string | null; email: string | null }): string {
  const full = `${a.first_name || ""} ${a.last_name || ""}`.trim();
  return full || a.email || "Guest";
}

function expandRsvp(r: RsvpRow): DisplayAttendee[] {
  const sidecar = parseSidecarAttendees(r.notes);
  const primary: DisplayAttendee = {
    key: `${r.id}-primary`,
    rsvpId: r.id,
    isPrimary: true,
    status: r.status,
    source: r.source,
    first_name: r.first_name,
    last_name: r.last_name,
    phone: r.phone,
    email: r.email,
    organisation_type: r.organisation_type,
    organisation_name: r.organisation_name,
    state: r.state,
  };

  if (!sidecar.length) return [primary];

  const primaryKey = normName({ first_name: r.first_name, last_name: r.last_name });
  const out: DisplayAttendee[] = [primary];
  const seen = new Set<string>([primaryKey || `email:${(r.email || "").toLowerCase()}`]);

  sidecar.forEach((a, i) => {
    const k = normName(a) || `email:${(a.email || "").toLowerCase()}` || `idx:${i}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({
      key: `${r.id}-a${i}`,
      rsvpId: r.id,
      isPrimary: false,
      status: r.status,
      source: r.source,
      first_name: a.first_name || null,
      last_name: a.last_name || null,
      phone: a.phone || null,
      // Guests inherit the sender's email unless explicitly provided
      email: a.email || r.email || null,
      organisation_type: a.organisation_type || null,
      organisation_name: a.organisation_name || null,
      state: a.location || null,
    });
  });

  return out;
}

export function EventRsvps({ eventId }: { eventId: string }) {
  const [rsvps, setRsvps] = useState<RsvpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("event_rsvps" as any)
        .select("*")
        .eq("event_id", eventId)
        .order("responded_at", { ascending: false });
      if (mounted) {
        setRsvps((data as any) || []);
        setLoading(false);
      }
    };
    load();

    const channel = supabase
      .channel(`rsvps-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_rsvps", filter: `event_id=eq.${eventId}` },
        load
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  const attendees = useMemo<DisplayAttendee[]>(
    () => rsvps.flatMap(expandRsvp),
    [rsvps]
  );

  if (loading) return null;

  const counts = attendees.reduce(
    (a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }),
    {} as Record<string, number>
  );

  const missingFor = (a: DisplayAttendee) =>
    FIELDS.filter((f) => !((a as any)[f] && String((a as any)[f]).trim().length > 0));

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3 w-3" />
          Attendees (RSVPs)
          {attendees.length > 0 && (
            <span>
              · {attendees.length} total · {counts.yes || 0} yes · {counts.maybe || 0} maybe · {counts.no || 0} no
            </span>
          )}
        </div>
      </div>
      {attendees.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
          No RSVPs yet. Attendees email <span className="font-mono">duncan@kabuni.com</span> with their first name, last name, phone (with country code), email, school / media / company name, and city / region.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {attendees.map((a) => {
            const missing = missingFor(a);
            const open = openKey === a.key;
            const name = displayName(a);
            return (
              <li key={a.key} className="border border-border rounded-md text-xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : a.key)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 ${statusColor[a.status]}`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium truncate">{name}</span>
                    {a.organisation_name && (
                      <span className="opacity-75 truncate">· {a.organisation_name}</span>
                    )}
                    {!a.isPrimary && (
                      <Badge variant="outline" className="text-[10px] bg-background/40 shrink-0">
                        guest
                      </Badge>
                    )}
                    {a.isPrimary && a.source === "email" && <Mail className="h-3 w-3 opacity-60 shrink-0" />}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {missing.length > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-background/40">
                        {missing.length} missing
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] capitalize bg-background/40">
                      {a.status}
                    </Badge>
                    {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </span>
                </button>
                {open && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 bg-background">
                    <div className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      <Detail label="First name" value={a.first_name} />
                      <Detail label="Last name" value={a.last_name} />
                    </div>
                    <Detail label="Email" value={a.email} icon={<Mail className="h-3 w-3" />} />
                    <Detail label="Phone" value={a.phone} icon={<Phone className="h-3 w-3" />} />
                    <Detail
                      label={a.organisation_type ? orgLabel[a.organisation_type] : "Organisation"}
                      value={a.organisation_name}
                      icon={<Building2 className="h-3 w-3" />}
                    />
                    <Detail label="City / Region" value={a.state} icon={<MapPin className="h-3 w-3" />} />
                    {missing.length > 0 && (
                      <div className="col-span-2 mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        Awaiting: {missing.map((f) => f.replace("_", " ")).join(", ")} (Duncan has emailed the attendee for these)
                      </div>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Detail({ label, value, icon }: { label: string; value: string | null; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon}{label}
      </dt>
      <dd className={`truncate ${value ? "" : "text-muted-foreground italic"}`}>
        {value || "—"}
      </dd>
    </div>
  );
}
