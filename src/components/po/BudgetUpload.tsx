import { useState, useRef } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useDepartments } from "@/hooks/useDepartments";
import { useUpsertBudget, useBulkUpsertBudgets } from "@/hooks/useBudgets";
import type { POCategory } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/hooks/use-toast";

const categories: { value: POCategory; label: string }[] = [
  { value: "events", label: "Events" },
  { value: "marketing", label: "Marketing" },
  { value: "social", label: "Social" },
  { value: "creative", label: "Creative" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "other", label: "Other" },
];

export default function BudgetUpload() {
  const { data: departments = [] } = useDepartments();
  const upsertBudget = useUpsertBudget();
  const bulkUpsert = useBulkUpsertBudgets();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [deptId, setDeptId] = useState("");
  const [category, setCategory] = useState<POCategory>("other");
  const [amount, setAmount] = useState("");
  const year = new Date().getFullYear();

  const handleManual = async () => {
    if (!deptId || !amount) return;
    await upsertBudget.mutateAsync({
      department_id: deptId,
      category,
      fiscal_year: year,
      allocated_amount: parseFloat(amount),
    });
    setAmount("");
  };

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(l => l.trim());
      // Expect: department_name, category, amount
      const rows: { department_id: string; category: POCategory; fiscal_year: number; allocated_amount: number }[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        if (cols.length < 3) continue;
        const dept = departments.find(d => d.name.toLowerCase() === cols[0].toLowerCase());
        if (!dept) {
          toast({ title: "Warning", description: `Department "${cols[0]}" not found, skipping row ${i + 1}`, variant: "destructive" });
          continue;
        }
        const cat = cols[1].toLowerCase().replace(/\s+/g, "_") as POCategory;
        if (!categories.find(c => c.value === cat)) continue;
        rows.push({
          department_id: dept.id,
          category: cat,
          fiscal_year: year,
          allocated_amount: parseFloat(cols[2]) || 0,
        });
      }

      if (rows.length > 0) {
        await bulkUpsert.mutateAsync(rows);
      } else {
        toast({ title: "No valid rows found", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Manual entry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Manual Budget Entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={v => setCategory(v as POCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Allocated Amount (£)</Label>
            <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <Button onClick={handleManual} disabled={upsertBudget.isPending} className="w-full">
            Save Budget Line
          </Button>
        </CardContent>
      </Card>

      {/* CSV upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">CSV Budget Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Upload a CSV with columns: <span className="font-mono">department_name, category, amount</span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            Categories: software, hardware, services, marketing, travel, office_supplies, other
          </p>
          <div className="border border-dashed border-border rounded-lg p-6 text-center">
            <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <Input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} className="max-w-xs mx-auto" />
          </div>
          {bulkUpsert.isPending && <p className="text-xs text-muted-foreground text-center">Importing...</p>}
        </CardContent>
      </Card>
    </div>
  );
}
