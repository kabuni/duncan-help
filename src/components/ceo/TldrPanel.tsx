import { Activity, AlertOctagon, Target } from "lucide-react";

interface Tldr {
  on_track?: string;
  what_will_break?: string;
  where_to_act?: string;
}

const TldrPanel = ({ tldr }: { tldr?: Tldr }) => {
  if (!tldr || (!tldr.on_track && !tldr.what_will_break && !tldr.where_to_act)) return null;

  const items = [
    { icon: Activity, label: "Are we on track?", value: tldr.on_track, accent: "text-primary", border: "border-primary/30", bg: "bg-primary/5" },
    { icon: AlertOctagon, label: "What will break?", value: tldr.what_will_break, accent: "text-destructive", border: "border-destructive/30", bg: "bg-destructive/5" },
    { icon: Target, label: "Where must I act?", value: tldr.where_to_act, accent: "text-foreground", border: "border-border", bg: "bg-card" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <div key={i} className={`rounded-lg border ${it.border} ${it.bg} p-4 space-y-2`}>
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${it.accent}`} />
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{it.label}</h3>
            </div>
            <p className="text-sm font-medium leading-snug text-foreground">{it.value || "—"}</p>
          </div>
        );
      })}
    </div>
  );
};

export default TldrPanel;
