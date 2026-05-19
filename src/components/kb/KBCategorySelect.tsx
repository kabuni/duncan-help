import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KB_CATEGORIES, KB_SUBCATEGORIES, KBCategory } from "@/lib/kbTaxonomy";

export function KBCategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
      <SelectContent>
        {KB_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function KBSubcategorySelect({
  category, value, onChange,
}: { category: string; value: string; onChange: (v: string) => void }) {
  const subs = KB_SUBCATEGORIES[category as KBCategory] ?? [];
  if (!subs.length) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select a subcategory" /></SelectTrigger>
      <SelectContent>
        {subs.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
