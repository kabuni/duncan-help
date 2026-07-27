import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { taskCodeHref } from "@/components/TaskIdLink";

type CardHit = {
  id: string;
  task_code: string;
  title: string;
  status: string | null;
  project_tag: string | null;
};

/**
 * Global search palette (Cmd/Ctrl+K).
 *
 * Looks up workstream cards by Task ID (WS-XXXX, exact or partial) or by
 * title, and opens the matching card via the /workstreams?card= deep link.
 * Task IDs are the single source of truth — no separate IDs are generated
 * here; this only reads from workstream_cards.task_code.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardHit[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Cmd/Ctrl+K toggles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const normalizedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (!open) return;
    if (!normalizedQuery) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      // Match either WS-XXXX (partial) or free-text title.
      const codePart = normalizedQuery.toUpperCase().replace(/^WS-?/, "");
      const looksLikeCode = /^\d+$/.test(codePart) || /^WS/i.test(normalizedQuery);

      const orFilter = looksLikeCode
        ? `task_code.ilike.%${codePart}%,title.ilike.%${normalizedQuery}%`
        : `title.ilike.%${normalizedQuery}%,task_code.ilike.%${normalizedQuery}%`;

      const { data, error } = await supabase
        .from("workstream_cards")
        .select("id, task_code, title, status, project_tag")
        .is("archived_at", null)
        .or(orFilter)
        .order("created_at", { ascending: false })
        .limit(15);

      if (cancelled) return;
      if (error) {
        setResults([]);
      } else {
        setResults((data || []) as CardHit[]);
      }
      setLoading(false);
    };
    const t = setTimeout(run, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [normalizedQuery, open]);

  const openCard = (code: string) => {
    setOpen(false);
    setQuery("");
    navigate(taskCodeHref(code));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search (⌘K)"
        aria-label="Global search"
        className="hidden md:inline-flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-background/60 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search tasks…</span>
        <kbd className="ml-2 hidden lg:inline text-[10px] font-mono text-muted-foreground/70 border border-border rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search by Task ID (WS-0042) or title…"
        />
        <CommandList>
          {!normalizedQuery ? (
            <CommandEmpty>Type a Task ID or title to search.</CommandEmpty>
          ) : loading ? (
            <CommandEmpty>Searching…</CommandEmpty>
          ) : results.length === 0 ? (
            <CommandEmpty>No matching tasks.</CommandEmpty>
          ) : (
            <CommandGroup heading="Workstream tasks">
              {results.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`${r.task_code} ${r.title}`}
                  onSelect={() => openCard(r.task_code)}
                >
                  <span className="font-mono text-xs text-primary mr-2">
                    {r.task_code}
                  </span>
                  <span className="truncate">{r.title}</span>
                  {r.project_tag && (
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                      {r.project_tag}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
