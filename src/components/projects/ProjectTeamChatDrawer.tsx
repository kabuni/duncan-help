import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  Send,
  Paperclip,
  X,
  Pin,
  Trash2,
  Pencil,
  Reply,
  Search,
  Check,
  CheckCheck,
  MoreVertical,
  Download,
  FileText,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format, isSameDay } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useProjectTeamChat, TeamChatMessage } from "@/hooks/useProjectTeamChat";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  isOwnerOrAdmin: boolean;
  members: { user_id: string; display_name?: string | null; avatar_url?: string | null }[];
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function AttachmentChip({
  attachment,
  onOpen,
}: {
  attachment: { path: string; name: string; type: string; size: number };
  onOpen: (path: string) => void;
}) {
  const isImage = attachment.type.startsWith("image/");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const { attachmentUrl } = useProjectTeamChatUrlHelper();
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    attachmentUrl(attachment.path).then((u) => {
      if (alive) setImgUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [attachment.path, isImage, attachmentUrl]);

  if (isImage && imgUrl) {
    return (
      <button
        onClick={() => onOpen(attachment.path)}
        className="block max-w-xs rounded-lg overflow-hidden border border-border hover:opacity-90 transition-opacity"
        title={attachment.name}
      >
        <img src={imgUrl} alt={attachment.name} className="max-h-56 w-auto object-cover" />
      </button>
    );
  }
  return (
    <button
      onClick={() => onOpen(attachment.path)}
      className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs hover:bg-secondary/60 transition-colors max-w-xs"
    >
      <FileText className="h-4 w-4 text-primary shrink-0" />
      <span className="truncate">{attachment.name}</span>
      <span className="text-muted-foreground shrink-0">{(attachment.size / 1024).toFixed(0)}KB</span>
      <Download className="h-3 w-3 text-muted-foreground shrink-0" />
    </button>
  );
}

// tiny helper hook to reuse signed-url fetcher without prop drilling
function useProjectTeamChatUrlHelper() {
  // Provided via context on the drawer
  return useAttachmentUrlContext();
}

import { createContext, useContext } from "react";
const AttachmentUrlCtx = createContext<{ attachmentUrl: (path: string) => Promise<string | null> }>({
  attachmentUrl: async () => null,
});
function useAttachmentUrlContext() {
  return useContext(AttachmentUrlCtx);
}

export function ProjectTeamChatDrawer({
  open,
  onOpenChange,
  projectId,
  projectName,
  isOwnerOrAdmin,
  members,
}: Props) {
  const { user } = useAuth();
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const {
    messages,
    loading,
    sending,
    seenByAllCutoff,
    typingUsers,
    sendMessage,
    editMessage,
    deleteMessage,
    togglePin,
    markAllRead,
    broadcastTyping,
    attachmentUrl,
  } = useProjectTeamChat(open ? projectId : null, memberIds);

  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<TeamChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [search, setSearch] = useState("");
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Mark as read when opened and when new messages arrive while open
  useEffect(() => {
    if (open) markAllRead();
  }, [open, messages.length, markAllRead]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, open]);

  const displayName = useMemo(() => {
    const me = members.find((m) => m.user_id === user?.id);
    return me?.display_name || user?.email || "Someone";
  }, [members, user]);

  const filtered = useMemo(() => {
    let list = messages;
    if (showPinnedOnly) list = list.filter((m) => m.pinned_at);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => (m.content || "").toLowerCase().includes(q));
    }
    return list;
  }, [messages, showPinnedOnly, search]);

  const pinnedMessages = useMemo(() => messages.filter((m) => m.pinned_at), [messages]);

  const openAttachment = async (path: string) => {
    const url = await attachmentUrl(path);
    if (url) window.open(url, "_blank");
  };

  const handleSubmit = async () => {
    if (editingId) {
      await editMessage(editingId, editingContent.trim());
      setEditingId(null);
      setEditingContent("");
      return;
    }
    await sendMessage(input, pendingFiles, replyTo?.id ?? null);
    setInput("");
    setPendingFiles([]);
    setReplyTo(null);
  };

  const typingList = Object.values(typingUsers);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl lg:max-w-3xl p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border pr-12 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Team Chat — {projectName}
            </SheetTitle>
            <div className="flex items-center gap-1">
              <Button
                variant={showPinnedOnly ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setShowPinnedOnly((v) => !v)}
                className="h-7 gap-1 text-xs"
              >
                <Pin className="h-3.5 w-3.5" />
                Pinned{pinnedMessages.length > 0 ? ` (${pinnedMessages.length})` : ""}
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search messages…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
        </SheetHeader>

        <AttachmentUrlCtx.Provider value={{ attachmentUrl }}>
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-background">
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-8">Loading messages…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                {search || showPinnedOnly ? "No messages match." : "No messages yet. Say hello 👋"}
              </p>
            ) : (
              filtered.map((msg, i) => {
                const prev = filtered[i - 1];
                const showDay = !prev || !isSameDay(new Date(prev.created_at), new Date(msg.created_at));
                const mine = msg.user_id === user?.id;
                const replied = msg.reply_to_id
                  ? messages.find((m) => m.id === msg.reply_to_id)
                  : null;
                const seen =
                  mine && !msg.deleted_at && seenByAllCutoff !== null && new Date(msg.created_at).getTime() <= seenByAllCutoff;
                return (
                  <div key={msg.id}>
                    {showDay && (
                      <div className="flex items-center justify-center my-3">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full">
                          {format(new Date(msg.created_at), "EEEE, MMM d")}
                        </span>
                      </div>
                    )}
                    <div className={cn("group flex gap-2", mine && "flex-row-reverse")}>
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarImage src={msg.author_avatar_url || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {initials(msg.author_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className={cn("max-w-[75%] flex flex-col", mine && "items-end")}>
                        <div
                          className={cn(
                            "text-[10px] text-muted-foreground flex items-center gap-1.5 mb-0.5",
                            mine && "flex-row-reverse",
                          )}
                        >
                          <span className="font-medium">{mine ? "You" : msg.author_name || "Unknown"}</span>
                          <span>·</span>
                          <span>{format(new Date(msg.created_at), "HH:mm")}</span>
                          {msg.edited_at && !msg.deleted_at && <span className="italic">(edited)</span>}
                          {msg.pinned_at && <Pin className="h-3 w-3 text-primary" />}
                        </div>
                        <div
                          className={cn(
                            "relative rounded-2xl px-3 py-2 text-sm break-words",
                            mine
                              ? "bg-primary text-primary-foreground rounded-tr-sm"
                              : "bg-secondary text-foreground rounded-tl-sm",
                            msg.deleted_at && "italic opacity-60",
                          )}
                        >
                          {replied && !msg.deleted_at && (
                            <div
                              className={cn(
                                "mb-1.5 border-l-2 pl-2 text-[11px] opacity-80",
                                mine ? "border-primary-foreground/50" : "border-primary/60",
                              )}
                            >
                              <div className="font-medium">
                                {replied.user_id === user?.id ? "You" : replied.author_name || "Reply"}
                              </div>
                              <div className="truncate max-w-[240px]">
                                {replied.deleted_at ? "(message deleted)" : replied.content || "(attachment)"}
                              </div>
                            </div>
                          )}
                          {editingId === msg.id ? (
                            <div className="flex flex-col gap-2 min-w-[220px]">
                              <Input
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className="h-7 text-xs text-foreground"
                                autoFocus
                              />
                              <div className="flex gap-1 justify-end">
                                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditingId(null)}>
                                  Cancel
                                </Button>
                                <Button size="sm" className="h-6 text-[11px]" onClick={handleSubmit}>
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : msg.deleted_at ? (
                            <span>Message deleted</span>
                          ) : (
                            <>
                              {msg.content && <div className="whitespace-pre-wrap leading-6">{msg.content}</div>}
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div className="mt-2 flex flex-col gap-1.5">
                                  {msg.attachments.map((a) => (
                                    <AttachmentChip key={a.path} attachment={a} onOpen={openAttachment} />
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        {mine && !msg.deleted_at && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            {seen ? (
                              <>
                                <CheckCheck className="h-3 w-3 text-primary" /> Seen
                              </>
                            ) : (
                              <>
                                <Check className="h-3 w-3" /> Sent
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {!msg.deleted_at && editingId !== msg.id && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={mine ? "end" : "start"} className="w-40">
                              <DropdownMenuItem onClick={() => setReplyTo(msg)}>
                                <Reply className="h-3.5 w-3.5 mr-2" /> Reply
                              </DropdownMenuItem>
                              {mine && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingId(msg.id);
                                    setEditingContent(msg.content);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                                </DropdownMenuItem>
                              )}
                              {isOwnerOrAdmin && (
                                <DropdownMenuItem onClick={() => togglePin(msg)}>
                                  <Pin className="h-3.5 w-3.5 mr-2" />
                                  {msg.pinned_at ? "Unpin" : "Pin"}
                                </DropdownMenuItem>
                              )}
                              {(mine || isOwnerOrAdmin) && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => deleteMessage(msg.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </AttachmentUrlCtx.Provider>

        {/* Typing indicator */}
        <div className="px-4 h-5 text-[11px] text-muted-foreground italic">
          {typingList.length === 1 && `${typingList[0].name} is typing…`}
          {typingList.length > 1 && `${typingList.length} people are typing…`}
        </div>

        {/* Reply preview */}
        {replyTo && (
          <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-xs">
            <div className="min-w-0">
              <div className="font-medium">
                Replying to {replyTo.user_id === user?.id ? "yourself" : replyTo.author_name || "message"}
              </div>
              <div className="truncate text-muted-foreground">{replyTo.content || "(attachment)"}</div>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyTo(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Pending file previews */}
        {pendingFiles.length > 0 && (
          <div className="mx-4 mb-2 flex flex-wrap gap-2">
            {pendingFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2 py-1 text-xs">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-border p-3 flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              setPendingFiles((prev) => [...prev, ...list].slice(0, 5));
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => fileRef.current?.click()}
            disabled={!!editingId}
            title="Attach files (up to 25MB each)"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <textarea
            value={editingId ? editingContent : input}
            onChange={(e) => {
              if (editingId) setEditingContent(e.target.value);
              else {
                setInput(e.target.value);
                broadcastTyping(displayName);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={editingId ? "Edit message…" : "Message team (Enter to send, Shift+Enter for newline)"}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:border-primary/40 max-h-32"
          />
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={sending || (editingId ? !editingContent.trim() : !input.trim() && pendingFiles.length === 0)}
            size="icon"
            className="h-9 w-9 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
