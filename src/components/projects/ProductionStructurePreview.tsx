import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { PRODUCTION_PROJECT_MAP, PRODUCTION_UNMAPPED } from "./productionMapping";

/**
 * Read-only reference panel showing how the REAL production workstream cards are
 * intended to sit inside Projects. Nothing here touches the database — it exists so the
 * structure can be reviewed before the feature is deployed into production Duncan.
 */
export function ProductionStructurePreview() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-10 rounded-xl border border-dashed border-border bg-secondary/20">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground">Planned structure in production Duncan</span>
        <span className="ml-auto rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Reference only
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-dashed border-border px-5 py-5">
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              These workstream cards live in production Duncan and are not present here. Nothing on this
              panel is real data in this environment, and nothing is created or copied. When Projects ships,
              each existing card is simply linked to its project — keeping its WS number, tasks, owners,
              dates, priority, status and history exactly as they are.
            </span>
          </p>

          <ul className="space-y-4">
            {PRODUCTION_PROJECT_MAP.map((project) => (
              <li key={project.name} className="rounded-lg border border-border bg-card px-4 py-3.5">
                <div className="flex items-baseline gap-2">
                  <h4 className="text-sm font-medium text-foreground">{project.name}</h4>
                  <span className="text-xs text-muted-foreground">Project</span>
                </div>
                <ul className="mt-2.5 space-y-1.5 border-l border-border pl-4">
                  {project.areas.map((area) => (
                    <li key={area.code} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-mono text-muted-foreground">{area.code}</span>
                      <span className="text-foreground">{area.title}</span>
                      <span className="text-muted-foreground">
                        · area of work{area.note ? ` — ${area.note.toLowerCase()}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <div>
            <h5 className="text-xs font-medium text-foreground">Left unmapped</h5>
            <ul className="mt-1.5 space-y-1">
              {PRODUCTION_UNMAPPED.map((card) => (
                <li key={card.code} className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span className="font-mono">{card.code}</span>
                  <span>{card.title}</span>
                  {card.note && <span>· {card.note}</span>}
                </li>
              ))}
              <li className="text-xs text-muted-foreground">
                Any other card whose project is unclear stays unmapped and untouched.
              </li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
