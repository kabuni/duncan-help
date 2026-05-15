import { useEffect, useMemo, useRef, useState } from "react";
import {
  X, Plus, Trash2, Pin, PinOff, Loader2, StickyNote, Paperclip, Download,
  FileText, Image as ImageIcon, Folder, FolderPlus, ChevronRight, ChevronDown,
  FolderOpen, MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useProjectNotes, type ProjectNote } from "@/hooks/useProjectNotes";
import { useNoteAttachments } from "@/hooks/useNoteAttachments";
import { useNoteFolders, type NoteFolder } from "@/hooks/useNoteFolders";
import { RichNoteEditor } from "./RichNoteEditor";
import { formatDistanceToNow } from "date-fns";

interface Props {
  projectId: string;
  template?: string | null;
  open: boolean;
  onClose: () => void;
}

function formatBytes(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface FolderNodeProps {
  folder: NoteFolder;
  childrenByParent: Map<string | null, NoteFolder[]>;
  notesByFolder: Map<string | null, ProjectNote[]>;
  expanded: Set<string>;
  toggleExpanded: (id: string) => void;
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onAddSubfolder: (parentId: string) => void;
  onRenameFolder: (folder: NoteFolder) => void;
  onDeleteFolder: (folder: NoteFolder) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  depth: number;
}

function FolderNode(p: FolderNodeProps) {
  const isOpen = p.expanded.has(p.folder.id);
  const subFolders = p.childrenByParent.get(p.folder.id) || [];
  const folderNotes = p.notesByFolder.get(p.folder.id) || [];
  const isSelected = p.selectedFolderId === p.folder.id;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs cursor-pointer ${
          isSelected ? "bg-primary/10 text-primary" : "hover:bg-secondary/60 text-foreground"
        }`}
        style={{ paddingLeft: `${p.depth * 12 + 4}px` }}
        onClick={() => p.onSelectFolder(p.folder.id)}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDrop={(e) => {
          e.preventDefault();
          const noteId = e.dataTransfer.getData("text/note-id");
          if (noteId) p.onMoveNote(noteId, p.folder.id);
        }}
      >
        <button
          className="h-4 w-4 flex items-center justify-center text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); p.toggleExpanded(p.folder.id); }}
        >
          {subFolders.length > 0 || folderNotes.length > 0
            ? (isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)
            : <span className="h-3 w-3" />}
        </button>
        {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate flex-1">{p.folder.name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded hover:bg-background"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => p.onAddSubfolder(p.folder.id)}>
              <FolderPlus className="h-3.5 w-3.5 mr-2" /> New subfolder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => p.onRenameFolder(p.folder)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => p.onDeleteFolder(p.folder)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isOpen && (
        <div>
          {subFolders.map((sf) => (
            <FolderNode key={sf.id} {...p} folder={sf} depth={p.depth + 1} />
          ))}
          {folderNotes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              active={p.activeNoteId === n.id}
              depth={p.depth + 1}
              onSelect={() => p.onSelectNote(n.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteRow({ note, active, depth, onSelect }: { note: ProjectNote; active: boolean; depth: number; onSelect: () => void }) {
  return (
    <button
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/note-id", note.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onSelect}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
      className={`group w-full text-left rounded-md pr-2 py-1 text-xs transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      }`}
    >
      <div className="flex items-center gap-1">
        {note.pinned && <Pin className="h-3 w-3 shrink-0" />}
        <StickyNote className="h-3 w-3 shrink-0 opacity-60" />
        <span className="truncate font-medium">{note.title || "Untitled note"}</span>
      </div>
    </button>
  );
}

export function ProjectNotesDrawer({ projectId, open, onClose }: Props) {
  const { notes, loading, createNote, updateNote, deleteNote } = useProjectNotes(open ? projectId : null);
  const { folders, createFolder, renameFolder, deleteFolder } = useNoteFolders(open ? projectId : null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const active: ProjectNote | undefined = notes.find((n) => n.id === activeId);
  const attachments = useNoteAttachments(active?.id ?? null, projectId);

  // Group folders/notes for tree
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, NoteFolder[]>();
    for (const f of folders) {
      const k = f.parent_folder_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    return m;
  }, [folders]);

  const notesByFolder = useMemo(() => {
    const m = new Map<string | null, ProjectNote[]>();
    for (const n of notes) {
      const k = n.folder_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return m;
  }, [notes]);

  const rootFolders = childrenByParent.get(null) || [];
  const rootNotes = notesByFolder.get(null) || [];

  useEffect(() => {
    if (!open) return;
    if (!activeId && notes.length > 0) setActiveId(notes[0].id);
  }, [open, notes, activeId]);

  useEffect(() => {
    if (active) { setTitle(active.title); setContent(active.content); }
    else { setTitle(""); setContent(""); }
  }, [activeId]); // eslint-disable-line

  useEffect(() => {
    if (!active) return;
    if (title === active.title && content === active.content) return;
    setSaving(true);
    const t = setTimeout(async () => {
      await updateNote(active.id, { title: title.trim() || "Untitled note", content });
      setSaving(false);
    }, 600);
    return () => clearTimeout(t);
  }, [title, content]); // eslint-disable-line

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleNewNote = async () => {
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const note = await createNote(`Note — ${today}`, "", selectedFolderId);
    if (note) {
      setActiveId(note.id);
      if (selectedFolderId) setExpanded((p) => new Set(p).add(selectedFolderId));
    }
  };

  const handleNewFolder = async (parentId: string | null = null) => {
    const name = window.prompt(parentId ? "Subfolder name" : "Folder name", "New folder");
    if (!name) return;
    const f = await createFolder(name, parentId);
    if (f && parentId) setExpanded((p) => new Set(p).add(parentId));
  };

  const handleRenameFolder = async (folder: NoteFolder) => {
    const name = window.prompt("Rename folder", folder.name);
    if (!name || name === folder.name) return;
    await renameFolder(folder.id, name);
  };

  const handleDeleteFolder = async (folder: NoteFolder) => {
    if (!window.confirm(`Delete folder "${folder.name}"? Notes inside will move to the root.`)) return;
    await deleteFolder(folder.id);
    if (selectedFolderId === folder.id) setSelectedFolderId(null);
  };

  const handleMoveNote = async (noteId: string, folderId: string | null) => {
    await updateNote(noteId, { folder_id: folderId });
  };

  const handleDelete = async (id: string) => {
    await deleteNote(id);
    if (activeId === id) setActiveId(null);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !active) return;
    for (const f of Array.from(files)) await attachments.upload(f);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[85vw] lg:w-[1100px] max-w-[1200px] h-full bg-background border-l border-border flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Notes</h2>
            {saving && <span className="text-[10px] text-muted-foreground">Saving…</span>}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => handleNewFolder(null)} className="gap-1.5 text-xs">
              <FolderPlus className="h-3.5 w-3.5" /> Folder
            </Button>
            <Button variant="outline" size="sm" onClick={handleNewNote} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Note
            </Button>
            <button onClick={onClose} className="ml-1 h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Tree */}
          <div className="w-64 shrink-0 border-r border-border flex flex-col bg-sidebar/40">
            <ScrollArea className="flex-1">
              {loading && notes.length === 0 && folders.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {/* Root drop zone */}
                  <div
                    className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs cursor-pointer ${
                      selectedFolderId === null ? "bg-primary/10 text-primary" : "hover:bg-secondary/60 text-foreground"
                    }`}
                    onClick={() => setSelectedFolderId(null)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const noteId = e.dataTransfer.getData("text/note-id");
                      if (noteId) handleMoveNote(noteId, null);
                    }}
                  >
                    <span className="h-4 w-4" />
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1">All notes</span>
                  </div>

                  {rootFolders.map((f) => (
                    <FolderNode
                      key={f.id}
                      folder={f}
                      childrenByParent={childrenByParent}
                      notesByFolder={notesByFolder}
                      expanded={expanded}
                      toggleExpanded={toggleExpanded}
                      selectedFolderId={selectedFolderId}
                      onSelectFolder={setSelectedFolderId}
                      activeNoteId={activeId}
                      onSelectNote={setActiveId}
                      onAddSubfolder={(pid) => handleNewFolder(pid)}
                      onRenameFolder={handleRenameFolder}
                      onDeleteFolder={handleDeleteFolder}
                      onMoveNote={handleMoveNote}
                      depth={0}
                    />
                  ))}

                  {rootNotes.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      active={activeId === n.id}
                      depth={0}
                      onSelect={() => setActiveId(n.id)}
                    />
                  ))}

                  {notes.length === 0 && folders.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6 px-3">
                      No notes yet. Create a folder or note above.
                    </p>
                  )}
                </div>
              )}
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground/70 px-3 py-1.5 border-t border-border">
              Drag notes onto folders to organise.
            </p>
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col min-w-0">
            {active ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    className="border-0 shadow-none focus-visible:ring-0 px-0 text-base font-medium"
                  />
                  <input ref={fileRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
                  <Button
                    variant="ghost" size="sm" onClick={() => fileRef.current?.click()}
                    className="h-8 w-8 p-0" aria-label="Attach"
                    disabled={attachments.uploading}
                  >
                    {attachments.uploading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Paperclip className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => updateNote(active.id, { pinned: !active.pinned })}
                    className="h-8 w-8 p-0" aria-label={active.pinned ? "Unpin" : "Pin"}
                  >
                    {active.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1" aria-label="Move">
                        <Folder className="h-3.5 w-3.5" />
                        Move
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                      <DropdownMenuItem onClick={() => handleMoveNote(active.id, null)}>
                        <FolderOpen className="h-3.5 w-3.5 mr-2" /> Root (no folder)
                      </DropdownMenuItem>
                      {folders.length > 0 && <DropdownMenuSeparator />}
                      {folders.map((f) => (
                        <DropdownMenuItem key={f.id} onClick={() => handleMoveNote(active.id, f.id)}>
                          <Folder className="h-3.5 w-3.5 mr-2" /> {f.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost" size="sm" onClick={() => handleDelete(active.id)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive" aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex-1 min-h-0">
                  <RichNoteEditor value={content} onChange={setContent} />
                </div>

                {attachments.items.length > 0 && (
                  <div className="border-t border-border px-4 py-2 shrink-0 max-h-40 overflow-y-auto">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      Attachments ({attachments.items.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {attachments.items.map((a) => {
                        const isImg = (a.mime_type || "").startsWith("image/");
                        return (
                          <div key={a.id} className="group relative flex items-center gap-2 border border-border rounded-md px-2 py-1.5 bg-secondary/40 max-w-[260px]">
                            {isImg && a.signed_url ? (
                              <img src={a.signed_url} alt={a.file_name} className="h-8 w-8 object-cover rounded" />
                            ) : isImg ? (
                              <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <FileText className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{a.file_name}</p>
                              <p className="text-[10px] text-muted-foreground">{formatBytes(a.size_bytes)}</p>
                            </div>
                            {a.signed_url && (
                              <a href={a.signed_url} target="_blank" rel="noreferrer"
                                 className="h-6 w-6 flex items-center justify-center rounded hover:bg-background text-muted-foreground hover:text-foreground">
                                <Download className="h-3 w-3" />
                              </a>
                            )}
                            <button onClick={() => attachments.remove(a)}
                                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-background text-muted-foreground hover:text-destructive">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
                <StickyNote className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Select a note or create a new one.</p>
                <Button variant="outline" size="sm" onClick={handleNewNote} className="gap-1.5">
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
