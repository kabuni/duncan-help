import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { Plan90Workstream } from "@/hooks/usePlan90";
import { PLAN90_PRIORITIES, PLAN90_STATUSES } from "@/hooks/usePlan90";

export interface Plan90FilterState {
  q: string;
  workstream: string;
  status: string;
  priority: string;
  owner: string;
  timeframe: string;
}

export const emptyFilters: Plan90FilterState = { q: "", workstream: "all", status: "all", priority: "all", owner: "all", timeframe: "all" };

interface Props {
  value: Plan90FilterState;
  onChange: (v: Plan90FilterState) => void;
  workstreams: Plan90Workstream[];
  owners: { id: string; name: string }[];
}

export function Plan90Filters({ value, onChange, workstreams, owners }: Props) {
  const has = value.q || value.workstream !== "all" || value.status !== "all" || value.priority !== "all" || value.owner !== "all" || value.timeframe !== "all";
  const set = (patch: Partial<Plan90FilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input placeholder="Search deliverables…" value={value.q} onChange={(e) => set({ q: e.target.value })} className="w-full sm:w-56 h-9" />
      <Select value={value.workstream} onValueChange={(v) => set({ workstream: v })}>
        <SelectTrigger className="w-full sm:w-44 h-9"><SelectValue placeholder="Workstream" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All workstreams</SelectItem>{workstreams.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={value.status} onValueChange={(v) => set({ status: v })}>
        <SelectTrigger className="w-full sm:w-36 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All statuses</SelectItem>{PLAN90_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={value.priority} onValueChange={(v) => set({ priority: v })}>
        <SelectTrigger className="w-full sm:w-32 h-9"><SelectValue placeholder="Priority" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All priorities</SelectItem>{PLAN90_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={value.owner} onValueChange={(v) => set({ owner: v })}>
        <SelectTrigger className="w-full sm:w-40 h-9"><SelectValue placeholder="Owner" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All owners</SelectItem>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={value.timeframe} onValueChange={(v) => set({ timeframe: v })}>
        <SelectTrigger className="w-full sm:w-36 h-9"><SelectValue placeholder="Timeframe" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any time</SelectItem>
          <SelectItem value="overdue">Overdue</SelectItem>
          <SelectItem value="soon">Due within 14 days</SelectItem>
          <SelectItem value="month">This month</SelectItem>
          <SelectItem value="next">Next month</SelectItem>
          <SelectItem value="later">Later</SelectItem>
        </SelectContent>
      </Select>
      {has && <Button variant="ghost" size="sm" onClick={() => onChange(emptyFilters)} className="h-9"><X className="h-3.5 w-3.5 mr-1" />Reset</Button>}
    </div>
  );
}
