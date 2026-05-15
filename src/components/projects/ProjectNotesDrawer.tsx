import { useEffect, useState } from "react";
import { X, Plus, Trash2, Pin, PinOff, Loader2, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProjectNotes, type ProjectNote } from "@/hooks/useProjectNotes";
import { formatDistanceToNow } from "date-fns";

interface Props {
  projectId: string;
  template?: string | null;
  open: boolean;
  onClose: () => void;
}

export function ProjectNotesDrawer({ projectId, template, open, onClose }: Props) {
  const { notes, loading, createNote, updateNote, deleteNote } = useProjectNotes(open ? projectId : null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const active: ProjectNote | undefined = notes.find((n) => n.id === activeId);

  useEffect(() => {
    if (!open) return;
    if (!activeId && notes.length > 0) setActiveId(notes[0].id);
  }, [open, notes, activeId]);

  useEffect(() => {
    if (active) {
      setTitle(active.title);
      setContent(active.content);
    } else {
      setTitle("");
      setContent("");
    }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced autosave
  useEffect(() => {
    if (!active) return;
    if (title === active.title && content === active.content) return;
    setSaving(true);
    const t = setTimeout(async () => {
      await updateNote(active.id, { title: title.trim() || "Untitled note", content });
      setSaving(false);
    }, 600);
    return () => clearTimeout(t);
  }, [title, content]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNew = async () => {
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const note = await createNote(`Note — ${today}`, "");
    if (note) setActiveId(note.id);
  };

  const handleDelete = async (id: string) => {
    await deleteNote(id);
    if (activeId === id) setActiveId(null);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[640px] h-full bg-background border-l border-border flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Notes</h2>
            {saving && <span className="text-[10px] text-muted-foreground">Saving…</span>}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={handleNew} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
            <button onClick={onClose} className="ml-1 h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Notes list */}
          <div className="w-56 shrink-0 border-r border-border flex flex-col bg-sidebar/40">
            <ScrollArea className="flex-1">
              {loading && notes.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : notes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6 px-3">No notes yet. Click New.</p>
              ) : (
                <div className="p-2 space-y-0.5">
                  {notes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setActiveId(n.id)}
                      className={`group w-full text-left rounded-md px-2 py-2 text-xs transition-colors ${
                        activeId === n.id
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        {n.pinned && <Pin className="h-3 w-3 shrink-0" />}
                        <span className="truncate font-medium">{n.title || "Untitled note"}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                        {formatDistanceToNow(new Date(n.updated_at), { addSuffix: true })}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col min-w-0">
            {active ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    className="border-0 shadow-none focus-visible:ring-0 px-0 text-sm font-medium"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateNote(active.id, { pinned: !active.pinned })}
                    className="h-8 w-8 p-0"
                    aria-label={active.pinned ? "Unpin" : "Pin"}
                  >
                    {active.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(active.id)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Start writing… Duncan can read this when you chat in this project."
                  className="flex-1 resize-none border-0 shadow-none focus-visible:ring-0 rounded-none text-sm leading-7 p-4"
                />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
                <StickyNote className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Select a note or create a new one.</p>
                <Button variant="outline" size="sm" onClick={handleNew} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> New note
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
