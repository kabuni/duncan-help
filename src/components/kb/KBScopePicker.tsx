import { Building2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type KBScope = "public" | "private";

export default function KBScopePicker({
  value, onChange,
}: { value: KBScope; onChange: (s: KBScope) => void }) {
  const card = (active: boolean) => cn(
    "flex-1 cursor-pointer rounded-lg border p-4 transition-all",
    active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"
  );
  return (
    <div className="flex gap-3">
      <button type="button" onClick={() => onChange("public")} className={card(value === "public")}>
        <Building2 className="h-5 w-5 mb-2 text-primary" />
        <div className="text-sm font-medium">Company</div>
        <div className="text-xs text-muted-foreground">Available to everyone</div>
      </button>
      <button type="button" onClick={() => onChange("private")} className={card(value === "private")}>
        <Lock className="h-5 w-5 mb-2 text-primary" />
        <div className="text-sm font-medium">Private</div>
        <div className="text-xs text-muted-foreground">Only you</div>
      </button>
    </div>
  );
}
