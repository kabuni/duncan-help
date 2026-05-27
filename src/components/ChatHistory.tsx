import { useEffect, useRef, useState } from "react";
import { MessageSquare, Plus, Trash2, ChevronDown, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneralChat } from "@/hooks/useGeneralChats";

interface ChatHistoryProps {
  chats: GeneralChat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat?: (chatId: string, title: string) => void | Promise<void>;
  onMobileClose?: () => void;
}

const ChatHistory = ({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onMobileClose,
}: ChatHistoryProps) => {
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleSelect = (chatId: string) => {
    if (editingId) return;
    onSelectChat(chatId);
    onMobileClose?.();
  };

  const startRename = (chat: GeneralChat) => {
    setEditingId(chat.id);
    setDraftTitle(chat.title);
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle("");
  };

  const commitRename = async () => {
    if (!editingId || !onRenameChat) return cancelRename();
    const next = draftTitle.trim();
    if (next && next.length > 0) {
      await onRenameChat(editingId, next.slice(0, 80));
    }
    cancelRename();
  };

  // Group chats: Today, Yesterday, Previous 7 Days, Older
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

  const groups: { label: string; items: GeneralChat[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 Days", items: [] },
    { label: "Older", items: [] },
  ];

  chats.forEach((chat) => {
    const d = new Date(chat.updated_at);
    if (d >= todayStart) groups[0].items.push(chat);
    else if (d >= yesterdayStart) groups[1].items.push(chat);
    else if (d >= weekStart) groups[2].items.push(chat);
    else groups[3].items.push(chat);
  });

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-150"
      >
        <MessageSquare className="h-4 w-4" />
        <span className="flex-1 text-left">Recents</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="ml-4 mt-1 border-l border-border pl-2 max-h-[40vh] overflow-y-auto scrollbar-thin">
          {/* New Chat button */}
          <button
            onClick={() => {
              onNewChat();
              onMobileClose?.();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors mb-1"
          >
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </button>

          {chats.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              No conversations yet
            </p>
          ) : (
            groups
              .filter((g) => g.items.length > 0)
              .map((group) => (
                <div key={group.label} className="mb-2">
                  <p className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                    {group.label}
                  </p>
                  {group.items.map((chat) => {
                    const isEditing = editingId === chat.id;
                    return (
                      <div
                        key={chat.id}
                        className={cn(
                          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                          activeChatId === chat.id && !isEditing
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          !isEditing && "cursor-pointer"
                        )}
                      >
                        {isEditing ? (
                          <>
                            <input
                              ref={inputRef}
                              value={draftTitle}
                              onChange={(e) => setDraftTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void commitRename();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              maxLength={80}
                              className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                              aria-label="Rename chat"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void commitRename();
                              }}
                              className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              title="Save"
                              aria-label="Save title"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelRename();
                              }}
                              className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
                              title="Cancel"
                              aria-label="Cancel rename"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleSelect(chat.id)}
                              onDoubleClick={(e) => {
                                if (!onRenameChat) return;
                                e.stopPropagation();
                                startRename(chat);
                              }}
                              className="flex-1 text-left truncate min-w-0"
                              title={onRenameChat ? `${chat.title} (double-click to rename)` : chat.title}
                            >
                              {chat.title}
                            </button>
                            {onRenameChat && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startRename(chat);
                                }}
                                className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Rename chat"
                                aria-label="Rename chat"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Delete chat "${chat.title}"? This cannot be undone.`)) {
                                  onDeleteChat(chat.id);
                                }
                              }}
                              className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                              title="Delete chat"
                              aria-label="Delete chat"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
};

export default ChatHistory;
