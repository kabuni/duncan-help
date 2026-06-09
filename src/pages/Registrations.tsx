import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Trash2, RefreshCw, Download, FileSpreadsheet, Info } from "lucide-react";
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

// Page groups for GA, scoped per category
const SCHOOLS_PAGE_GROUPS: PageGroup[] = [
  { key: "schools", label: "Schools", paths: ["/schools", "/schools/"] },
  { key: "register-school", label: "School Registration", paths: ["/register-school", "/register-school/"] },
];

const KPL_PAGE_GROUPS: PageGroup[] = [
  { key: "kabuni-premier-league", label: "Kabuni Premier League", paths: ["/kabuni-premier-league", "/kabuni-premier-league/"] },
];

// Category registry — add new entries here to scale (Events, Recruitment, Scout, etc.)
type CategoryKey = "schools" | "kpl";
const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "schools", label: "Schools Registrations" },
  { key: "kpl", label: "KPL Registrations" },
];

const ALL_PAGE_GROUPS: PageGroup[] = [...SCHOOLS_PAGE_GROUPS, ...KPL_PAGE_GROUPS];

export default function SchoolRegistrations() {
  const { isAdmin, isLoading: loadingRole } = useIsAdmin();
  const [rows, setRows] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<CategoryKey>("schools");

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

          <PagesAnalytics title="Schools Analytics" groups={SCHOOLS_PAGE_GROUPS} />

          <RegistrationsSummaryCards rows={rows} />

          <RegistrationsAnalytics rows={rows} />

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

          <PagesAnalytics title="Kabuni Premier League Analytics" groups={KPL_PAGE_GROUPS} />

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
        </TabsContent>
      </Tabs>
    </div>
  );
}
