import { useState } from "react";
import { Plus, Search, Building2, ExternalLink, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSuppliers } from "@/hooks/useSuppliers";
import SupplierDetailModal from "./SupplierDetailModal";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  expired: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  none: "bg-muted text-muted-foreground border-border",
};

export default function SuppliersDirectory() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const { data: suppliers = [], isLoading } = useSuppliers(search);

  const filtered = suppliers.filter(s => typeFilter === "all" || s.type === typeFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers..." className="pl-9" />
        </div>
        <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
          <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-1">
            {["all", "supplier", "stakeholder", "partner"].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  typeFilter === t
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <Button onClick={() => { setIsNew(true); setOpenId(null); }}>
            <Plus className="h-4 w-4 mr-1.5" /> Add supplier
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg">
          <Building2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">No suppliers yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Add supplier" to create the first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(s => (
            <button
              key={s.id}
              onClick={() => { setOpenId(s.id); setIsNew(false); }}
              className="text-left rounded-lg border border-border bg-card p-4 hover:border-primary/50 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start gap-3 mb-3">
                {s.logo_url ? (
                  <img src={s.logo_url} alt="" className="h-10 w-10 rounded-md object-contain bg-muted" />
                ) : (
                  <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">{s.name}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[10px] capitalize">{s.type}</Badge>
                    {s.contract_status && (
                      <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_COLORS[s.contract_status] || ""}`}>
                        {s.contract_status}
                      </Badge>
                    )}
                  </div>
                </div>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {s.services.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {s.services.slice(0, 4).map(svc => (
                    <span key={svc} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{svc}</span>
                  ))}
                  {s.services.length > 4 && <span className="text-[10px] text-muted-foreground">+{s.services.length - 4}</span>}
                </div>
              )}
              {s.website && (
                <a
                  href={s.website.startsWith("http") ? s.website : `https://${s.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> {s.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </button>
          ))}
        </div>
      )}

      <SupplierDetailModal
        supplierId={openId}
        isNew={isNew}
        open={openId !== null || isNew}
        onClose={() => { setOpenId(null); setIsNew(false); }}
      />
    </div>
  );
}
