import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Trash2, RefreshCw, Download, FileSpreadsheet, Info, Upload } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import RegistrationsAnalytics from "@/components/school-registrations/RegistrationsAnalytics";
import RegistrationsSummaryCards from "@/components/school-registrations/RegistrationsSummaryCards";
import PagesAnalytics, { type PageGroup } from "@/components/school-registrations/PagesAnalytics";
import GlobalRegistrationsSummary from "@/components/school-registrations/GlobalRegistrationsSummary";

type Registration = {
  id: string;
  school_name: string;
  contact_name: string;
  role: string | null;
  number_of_schools: number | null;
  email: string;
  phone: string;
  notes: string | null;
  created_at: string;
};

type EventAttendee = {
  id: string;
  event_name: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  city: string | null;
  raw: Record<string, unknown>;
  created_at: string;
};

const DEFAULT_EVENT_NAME = "Kabuni Showcase - Mumbai (Jio World Center)";

const FIELD_ALIASES: Record<keyof Pick<EventAttendee, "name" | "email" | "phone" | "company" | "role" | "city">, string[]> = {
  name: ["name", "full name", "fullname", "attendee", "attendee name", "first name"],
  email: ["email", "email address", "e-mail", "mail"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact", "contact number", "tel", "telephone"],
  company: ["company", "organisation", "organization", "school", "institution", "company name", "school name"],
  role: ["role", "title", "designation", "job title", "position"],
  city: ["city", "location", "town"],
};

type AttendeeCategory = "schools" | "vip" | "guests" | "other";

const CATEGORY_LABEL: Record<AttendeeCategory, string> = {
  schools: "Schools",
  vip: "VIP",
  guests: "Guests",
  other: "Other",
};

function classifyAttendee(e: { raw?: Record<string, unknown> | null }): AttendeeCategory {
  const sheet = String((e.raw as Record<string, unknown> | null)?.__sheet ?? "").toLowerCase();
  if (!sheet) return "other";
  if (sheet.includes("vip")) return "vip";
  if (sheet.includes("school") || sheet.includes("nie") || sheet.includes("glf") || sheet.includes("gslc")) return "schools";
  if (sheet.includes("guest")) return "guests";
  return "other";
}

function pickField(row: Record<string, unknown>, aliases: string[]): string | null {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(row)) normalized[k.toLowerCase().trim()] = row[k];
  for (const a of aliases) {
    const v = normalized[a];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

// Parse a worksheet into row objects, auto-detecting the header row.
// Handles sheets where the first row is a title/banner rather than column headers.
function parseSheetRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  if (!aoa.length) return [];
  const HEADER_HINTS = ["name", "email", "e-mail", "mail", "phone", "mobile", "company", "school", "organisation", "organization", "attendee", "first name", "last name", "full name"];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = aoa[i] ?? [];
    const cells = row.map((c) => String(c ?? "").toLowerCase().trim());
    if (cells.some((c) => HEADER_HINTS.includes(c))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];
  const rawHeaders = (aoa[headerIdx] ?? []).map((c) => String(c ?? "").trim());
  const headers = rawHeaders.map((h, idx) => (h === "" ? `__col_${idx}` : h));
  const out: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const obj: Record<string, unknown> = {};
    let hasVal = false;
    for (let j = 0; j < headers.length; j++) {
      const v = row[j];
      obj[headers[j]] = v ?? "";
      if (v != null && String(v).trim() !== "") hasVal = true;
    }
    if (hasVal) out.push(obj);
  }
  return out;
}

// Page groups for GA, scoped per category
const SCHOOLS_PAGE_GROUPS: PageGroup[] = [
  { key: "schools", label: "Schools", paths: ["/schools", "/schools/"] },
  { key: "register-school", label: "School Registration", paths: ["/register-school", "/register-school/"] },
];

const KPL_PAGE_GROUPS: PageGroup[] = [
  { key: "kabuni-premier-league", label: "Kabuni Premier League", paths: ["/kabuni-premier-league", "/kabuni-premier-league/"] },
];

const EVENTS_PAGE_GROUPS: PageGroup[] = [
  { key: "events", label: "Events", paths: ["/events", "/events/"] },
  { key: "register-event", label: "Event Registration", paths: ["/register-event", "/register-event/"] },
];

// Category registry — add new entries here to scale (Events, Recruitment, Scout, etc.)
type CategoryKey = "schools" | "kpl" | "events";
const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "schools", label: "Schools Registrations" },
  { key: "kpl", label: "KPL Registrations" },
  { key: "events", label: "Event Registrations" },
];

const ALL_PAGE_GROUPS: PageGroup[] = [...SCHOOLS_PAGE_GROUPS, ...KPL_PAGE_GROUPS, ...EVENTS_PAGE_GROUPS];

export default function SchoolRegistrations() {
  const { isAdmin, isLoading: loadingRole } = useIsAdmin();
  const [rows, setRows] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<CategoryKey>("schools");

  // Event attendees state
  const [events, setEvents] = useState<EventAttendee[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadEvents = async () => {
    setEventsLoading(true);
    const { data, error } = await supabase
      .from("event_attendees")
      .select("*")
      .order("created_at", { ascending: false });
    setEventsLoading(false);
    if (error) {
      toast.error("Failed to load event attendees");
      return;
    }
    setEvents((data ?? []) as EventAttendee[]);
  };

  const handleUploadEvents = async (file: File) => {
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const batch = crypto.randomUUID();
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id ?? null;

      const allRows: Record<string, unknown>[] = [];
      const perSheet: { sheet: string; kept: number; total: number }[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const parsed = parseSheetRows(sheet);
        const kept = parsed
          .map((r) => ({ ...r, __sheet: sheetName }))
          .filter((r) => {
            const name = pickField(r, FIELD_ALIASES.name);
            const email = pickField(r, FIELD_ALIASES.email);
            return !!(name || email);
          });
        perSheet.push({ sheet: sheetName, kept: kept.length, total: parsed.length });
        allRows.push(...kept);
      }

      if (!allRows.length) {
        const detail = perSheet.map((s) => `${s.sheet}: ${s.kept}/${s.total}`).join(", ");
        toast.error(`No attendee rows found. Sheets scanned — ${detail || "none"}`);
        return;
      }

      // De-duplicate within the file by email (case-insensitive) then by name+company
      const seen = new Set<string>();
      const deduped = allRows.filter((r) => {
        const email = (pickField(r, FIELD_ALIASES.email) || "").toLowerCase();
        const name = (pickField(r, FIELD_ALIASES.name) || "").toLowerCase();
        const company = (pickField(r, FIELD_ALIASES.company) || "").toLowerCase();
        const key = email || `${name}|${company}`;
        if (!key) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const rows = deduped.map((r) => ({
        event_name: DEFAULT_EVENT_NAME,
        name: pickField(r, FIELD_ALIASES.name),
        email: pickField(r, FIELD_ALIASES.email),
        phone: pickField(r, FIELD_ALIASES.phone),
        company: pickField(r, FIELD_ALIASES.company),
        role: pickField(r, FIELD_ALIASES.role),
        city: pickField(r, FIELD_ALIASES.city),
        raw: r as any,
        uploaded_by: uid,
        upload_batch_id: batch,
      }));
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase.from("event_attendees").insert(rows.slice(i, i + CHUNK));
        if (error) throw error;
      }
      const sheetSummary = perSheet.filter((s) => s.kept > 0).map((s) => `${s.sheet} (${s.kept})`).join(", ");
      toast.success(`Imported ${rows.length} attendees from ${sheetSummary || "1 sheet"}`);
      await loadEvents();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };


  const handleDeleteEvent = async (id: string) => {
    if (!confirm("Delete this attendee?")) return;
    const { error } = await supabase.from("event_attendees").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed");
      return;
    }
    setEvents((r) => r.filter((x) => x.id !== id));
    toast.success("Deleted");
  };

  const handleClearAllEvents = async () => {
    if (!events.length) return;
    if (!confirm(`Delete ALL ${events.length} attendees? This cannot be undone.`)) return;
    const { error } = await supabase
      .from("event_attendees")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      toast.error("Clear failed");
      return;
    }
    setEvents([]);
    toast.success("Cleared");
  };

  const exportEventRows = () =>
    (eventCategory === "all" ? events : events.filter((e) => classifyAttendee(e) === eventCategory)).map((e) => ({
      Imported: format(new Date(e.created_at), "yyyy-MM-dd HH:mm"),
      Event: e.event_name,
      Category: CATEGORY_LABEL[classifyAttendee(e)],
      Name: e.name ?? "",
      Email: e.email ?? "",
      Phone: e.phone ?? "",
      Company: e.company ?? "",
      Role: e.role ?? "",
      City: e.city ?? "",
    }));


  const handleExportEventsCsv = () => {
    if (!events.length) return toast.error("Nothing to export");
    const ws = XLSX.utils.json_to_sheet(exportEventRows());
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `event-attendees-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportEventsXlsx = () => {
    if (!events.length) return toast.error("Nothing to export");
    const ws = XLSX.utils.json_to_sheet(exportEventRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendees");
    XLSX.writeFile(wb, `event-attendees-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  useEffect(() => {
    if (isAdmin) loadEvents();
  }, [isAdmin]);

  const eventsThisWeek = useMemo(() => {
    const since = Date.now() - 7 * 86400000;
    return events.filter((e) => new Date(e.created_at).getTime() >= since).length;
  }, [events]);
  const eventsThisMonth = useMemo(() => {
    const since = Date.now() - 30 * 86400000;
    return events.filter((e) => new Date(e.created_at).getTime() >= since).length;
  }, [events]);

  const eventCounts = useMemo(() => {
    const c = { schools: 0, vip: 0, guests: 0, other: 0 };
    for (const e of events) c[classifyAttendee(e)] += 1;
    return c;
  }, [events]);

  const [eventCategory, setEventCategory] = useState<"all" | AttendeeCategory>("all");

  const filteredEvents = useMemo(() => {
    if (eventCategory === "all") return events;
    return events.filter((e) => classifyAttendee(e) === eventCategory);
  }, [events, eventCategory]);


  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("school_registrations")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Failed to load registrations");
      return;
    }
    setRows((data ?? []) as Registration[]);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this registration?")) return;
    const { error } = await supabase.from("school_registrations").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed");
      return;
    }
    setRows((r) => r.filter((x) => x.id !== id));
    toast.success("Deleted");
  };

  const exportRows = useMemo(
    () => () =>
      rows.map((r) => ({
        Submitted: format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
        School: r.school_name,
        Contact: r.contact_name,
        Role: r.role ?? "",
        "Number of schools": r.number_of_schools ?? "",
        Email: r.email,
        Phone: r.phone ?? "",
        Notes: r.notes ?? "",
      })),
    [rows],
  );

  const handleExportCsv = () => {
    if (!rows.length) return toast.error("Nothing to export");
    const ws = XLSX.utils.json_to_sheet(exportRows());
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registrations-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportXlsx = () => {
    if (!rows.length) return toast.error("Nothing to export");
    const ws = XLSX.utils.json_to_sheet(exportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registrations");
    XLSX.writeFile(wb, `registrations-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  if (loadingRole) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Registrations</h1>
          <p className="text-sm text-muted-foreground">
            Submissions and engagement across public registration channels.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <GlobalRegistrationsSummary totalRegistrations={rows.length} groups={ALL_PAGE_GROUPS} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as CategoryKey)} className="space-y-6">
        <TabsList className="h-auto w-full justify-start gap-2 bg-transparent p-0 border-b rounded-none">
          {CATEGORIES.map((c) => (
            <TabsTrigger
              key={c.key}
              value={c.key}
              className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-base font-semibold text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Schools */}
        <TabsContent value="schools" className="space-y-6 mt-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold tracking-tight">Schools Registrations</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!rows.length}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportXlsx} disabled={!rows.length}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>

          <RegistrationsSummaryCards rows={rows} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {rows.length} {rows.length === 1 ? "registration" : "registrations"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No registrations yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Submitted</TableHead>
                        <TableHead>School</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right"># Schools</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(r.created_at), "d MMM yyyy HH:mm")}
                          </TableCell>
                          <TableCell className="font-medium">{r.school_name}</TableCell>
                          <TableCell>{r.contact_name}</TableCell>
                          <TableCell>{r.role ?? "—"}</TableCell>
                          <TableCell className="text-right">{r.number_of_schools ?? "—"}</TableCell>
                          <TableCell>
                            <a href={`mailto:${r.email}`} className="text-primary hover:underline">
                              {r.email}
                            </a>
                          </TableCell>
                          <TableCell>{r.phone ?? "—"}</TableCell>
                          <TableCell
                            className="max-w-xs truncate text-sm text-muted-foreground"
                            title={r.notes ?? ""}
                          >
                            {r.notes ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <PagesAnalytics title="Schools Analytics" groups={SCHOOLS_PAGE_GROUPS} hideOverall />

          <RegistrationsAnalytics rows={rows} />
        </TabsContent>

        {/* KPL */}
        <TabsContent value="kpl" className="space-y-6 mt-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold tracking-tight">KPL Registrations</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button variant="outline" size="sm" disabled>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Total Registrations</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">—</div>
                <div className="mt-1 text-xs text-muted-foreground">No KPL form connected</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">This Week</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">—</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">This Month</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">—</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">KPL Registrations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  KPL registration submissions aren't being captured yet. Once a KPL form is wired to the backend,
                  submissions and exports will appear here automatically alongside the analytics above.
                </div>
              </div>
            </CardContent>
          </Card>

          <PagesAnalytics title="Kabuni Premier League Analytics" groups={KPL_PAGE_GROUPS} hideOverall />
        </TabsContent>

        {/* Events */}
        <TabsContent value="events" className="space-y-6 mt-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Event Registrations</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {DEFAULT_EVENT_NAME} — upload the attendee list from Google Sheets (.xlsx or .csv).
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadEvents(f);
                }}
              />
              <Button
                variant="default"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload sheet
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportEventsCsv}
                disabled={!events.length}
              >
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportEventsXlsx}
                disabled={!events.length}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
              {events.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleClearAllEvents}>
                  <Trash2 className="h-4 w-4 mr-2 text-muted-foreground" />
                  Clear all
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { key: "all", label: "Total Attendees", count: events.length, sub: DEFAULT_EVENT_NAME },
              { key: "schools", label: "Schools", count: eventCounts.schools, sub: "NIE, Non-NIE, GLF, GSLC" },
              { key: "vip", label: "VIP", count: eventCounts.vip, sub: "From Guest List Final" },
              { key: "guests", label: "Guests", count: eventCounts.guests, sub: "Kabuni guest list" },
            ] as const).map((tile) => {
              const active = eventCategory === tile.key;
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => setEventCategory(tile.key)}
                  className={`text-left rounded-lg border bg-card p-4 transition-colors ${
                    active ? "border-primary ring-1 ring-primary/30" : "hover:bg-secondary/40"
                  }`}
                >
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{tile.label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{tile.count}</div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-1">{tile.sub}</div>
                </button>
              );
            })}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">
                {filteredEvents.length} {filteredEvents.length === 1 ? "attendee" : "attendees"}
                {eventCategory !== "all" && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    · {CATEGORY_LABEL[eventCategory]}
                  </span>
                )}
              </CardTitle>
              {eventCategory !== "all" && (
                <Button variant="ghost" size="sm" onClick={() => setEventCategory("all")}>
                  Show all
                </Button>
              )}
            </CardHeader>

            <CardContent>
              {eventsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : events.length === 0 ? (
                <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    No attendees uploaded yet. Click <span className="font-medium text-foreground">Upload sheet</span> to
                    import the Google Sheet for the {DEFAULT_EVENT_NAME}. Column headers like{" "}
                    <code className="px-1 rounded bg-muted text-foreground">Name</code>,{" "}
                    <code className="px-1 rounded bg-muted text-foreground">Email</code>,{" "}
                    <code className="px-1 rounded bg-muted text-foreground">Phone</code>,{" "}
                    <code className="px-1 rounded bg-muted text-foreground">Company</code>,{" "}
                    <code className="px-1 rounded bg-muted text-foreground">Role</code>, and{" "}
                    <code className="px-1 rounded bg-muted text-foreground">City</code> will be detected automatically.
                    Any extra columns are preserved.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Imported</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEvents.map((e) => {
                        const cat = classifyAttendee(e);
                        return (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(e.created_at), "d MMM yyyy HH:mm")}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {CATEGORY_LABEL[cat]}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium">{e.name ?? "—"}</TableCell>
                          <TableCell>
                            {e.email ? (
                              <a href={`mailto:${e.email}`} className="text-primary hover:underline">
                                {e.email}
                              </a>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>{e.phone ?? "—"}</TableCell>
                          <TableCell>{e.company ?? "—"}</TableCell>
                          <TableCell>{e.role ?? "—"}</TableCell>
                          <TableCell>{e.city ?? "—"}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteEvent(e.id)}>
                              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        );
                      })}

                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
