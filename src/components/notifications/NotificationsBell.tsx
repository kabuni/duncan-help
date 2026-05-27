import { Bell, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export function NotificationsBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent" aria-label="Notifications">
          <Bell className="h-3.5 w-3.5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-sm font-semibold">Notifications</div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead()}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Check className="h-3 w-3" /> Mark all read
            </button>
          )}
        </div>
        <ScrollArea className="max-h-[400px]">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const unread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        if (unread) markRead(n.id);
                        if (n.link) navigate(n.link);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex gap-2 items-start",
                        unread && "bg-primary/5",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 rounded-full shrink-0",
                          unread ? "bg-primary" : "bg-transparent",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground truncate">
                          {n.title}
                        </div>
                        {n.body && (
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {n.body}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground/70 mt-1">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
