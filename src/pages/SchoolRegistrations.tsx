import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trash2, RefreshCw, Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import * as XLSX from "xlsx";

type Registration = {
  id: string;
  school_name: string;
  contact_name: string;
  role: string | null;
  number_of_schools: number | null;
  email: string;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

export default function SchoolRegistrations() {
  const { isAdmin, isLoading: loadingRole } = useIsAdmin();
  const [rows, setRows] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

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

  const exportRows = () =>
    rows.map((r) => ({
      Submitted: format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
      School: r.school_name,
      Contact: r.contact_name,
      Role: r.role ?? "",
      "Number of schools": r.number_of_schools ?? "",
      Email: r.email,
      Phone: r.phone ?? "",
      Notes: r.notes ?? "",
    }));

  const handleExportCsv = () => {
    if (!rows.length) return toast.error("Nothing to export");
    const ws = XLSX.utils.json_to_sheet(exportRows());
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `school-registrations-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportXlsx = () => {
    if (!rows.length) return toast.error("Nothing to export");
    const ws = XLSX.utils.json_to_sheet(exportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registrations");
    XLSX.writeFile(wb, `school-registrations-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
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
          <h1 className="text-2xl font-bold tracking-tight">School Registrations</h1>
          <p className="text-sm text-muted-foreground">Submissions from the public registration form.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportXlsx} disabled={!rows.length}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>


      <Card>
        <CardHeader>
          <CardTitle className="text-base">{rows.length} {rows.length === 1 ? "registration" : "registrations"}</CardTitle>
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
                      <TableCell>
                        <a href={`mailto:${r.email}`} className="text-primary hover:underline">{r.email}</a>
                      </TableCell>
                      <TableCell>{r.phone ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground" title={r.notes ?? ""}>
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
    </div>
  );
}
