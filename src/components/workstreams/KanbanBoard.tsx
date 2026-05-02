import { useState } from "react";
import { CalendarDays, Users, CheckCircle2, Circle } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { Badge } from "@/components/ui/badge";
import type { WorkstreamCard, CardStatus } from "@/hooks/useWorkstreams";
import { useUpdateCard } from "@/hooks/useWorkstreams";
import { StatusBadge, getStatusBorderClass, priorityConfig } from "./StatusBadge";

const COLUMNS: { status: CardStatus; label: string; emoji: string }[] = [
  { status: "not_started", label: "Not started", emoji: "⚪" },
  { status: "red", label: "Red", emoji: "🔴" },
  { status: "amber", label: "Yellow", emoji: "🟡" },
  { status: "green", label: "Green", emoji: "🟢" },
  { status: "done", label: "Done", emoji: "✅" },
];

interface KanbanBoardProps {
  cards: WorkstreamCard[];
  onCardClick: (card: WorkstreamCard) => void;
}

export default function KanbanBoard({ cards, onCardClick }: KanbanBoardProps) {
  const updateCard = useUpdateCard();
  const [dragOverCol, setDragOverCol] = useState<CardStatus | null>(null);

  const handleDragStart = (e: React.DragEvent, card: WorkstreamCard) => {
    e.dataTransfer.setData("cardId", card.id);
    e.dataTransfer.setData("cardStatus", card.status);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, status: CardStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  };

  const handleDragLeave = () => setDragOverCol(null);

  const handleDrop = (e: React.DragEvent, newStatus: CardStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const cardId = e.dataTransfer.getData("cardId");
    const oldStatus = e.dataTransfer.getData("cardStatus");
    if (cardId && oldStatus !== newStatus) {
      updateCard.mutate({ id: cardId, status: newStatus });
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
      {COLUMNS.map(col => {
        const colCards = cards.filter(c => c.status === col.status);
        return (
          <div
            key={col.status}
            className={`min-h-[200px] rounded-xl border transition-colors duration-200 ${
              dragOverCol === col.status
                ? "border-primary bg-primary/5"
                : "border-border bg-card/30"
            }`}
            onDragOver={e => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, col.status)}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <span className="text-sm">{col.emoji}</span>
                <span className="text-xs font-semibold text-foreground">{col.label}</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded-md">
                {colCards.length}
              </span>
            </div>

            <div className="p-2 space-y-2">
              {colCards.map(card => (
                <KanbanCard key={card.id} card={card} onClick={() => onCardClick(card)} onDragStart={handleDragStart} />
              ))}
              {colCards.length === 0 && (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
                  No cards
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ card, onClick, onDragStart }: {
  card: WorkstreamCard;
  onClick: () => void;
  onDragStart: (e: React.DragEvent, card: WorkstreamCard) => void;
}) {
  const isOverdue = card.due_date && isPast(new Date(card.due_date)) && card.status !== "done";
  const isDueToday = card.due_date && isToday(new Date(card.due_date));
  const assignees = card.assignees || [];

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, card)}
      onClick={onClick}
      className={`group cursor-pointer rounded-lg border border-l-[3px] bg-card p-3 transition-all hover:shadow-md hover:border-primary/30 ${getStatusBorderClass(card.status)}`}
    >
      {/* Tag */}
      <div className="flex items-center justify-end mb-2">
        {card.project_tag && (
          <span className="text-[9px] font-mono bg-secondary/80 text-muted-foreground px-1.5 py-0.5 rounded">
            {card.project_tag}
          </span>
        )}
      </div>

      <h4 className="text-sm font-semibold text-foreground leading-snug mb-2 line-clamp-2">
        {card.title}
      </h4>

      {card.description && (
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-3 line-clamp-2">
          {card.description}
        </p>
      )}

      {/* Overall (computed) status + breakdown */}
      {card.tasks_total! > 0 && card.overall_status && card.task_breakdown && (
        <div className="flex items-center gap-2 mb-2 text-[10px]">
          <span className="text-muted-foreground">Overall</span>
          <OverallDot status={card.overall_status} />
          <span className="text-muted-foreground/80 font-mono">
            {card.task_breakdown.not_started > 0 && <span className="text-muted-foreground">{card.task_breakdown.not_started}NS </span>}
            {card.task_breakdown.red > 0 && <span className="text-red-500">{card.task_breakdown.red}R </span>}
            {card.task_breakdown.yellow > 0 && <span className="text-amber-500">{card.task_breakdown.yellow}Y </span>}
            {card.task_breakdown.green > 0 && <span className="text-emerald-500">{card.task_breakdown.green}G </span>}
            {card.task_breakdown.done > 0 && <span className="text-primary">{card.task_breakdown.done}✓</span>}
          </span>
        </div>
      )}

      {/* Footer: tasks + assignees + due date */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 overflow-hidden">
          {card.tasks_total! > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
              {card.tasks_completed === card.tasks_total ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span>{card.tasks_completed}/{card.tasks_total}</span>
            </div>
          )}

          {/* Assignees */}
          {assignees.length > 0 && (
            <div className="flex items-center gap-1 overflow-hidden">
              {assignees.slice(0, 2).map(a => (
                <Badge key={a.user_id} variant="secondary" className="text-[9px] py-0 px-1 shrink-0">
                  {(a.display_name || "?").split(" ")[0]}
                </Badge>
              ))}
              {assignees.length > 2 && (
                <span className="text-[9px] text-muted-foreground">+{assignees.length - 2}</span>
              )}
            </div>
          )}
          {/* Fallback to owner_name if no assignees */}
          {assignees.length === 0 && card.owner_name && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="h-3 w-3" />
              <span className="truncate max-w-[60px]">{card.owner_name.split(" ")[0]}</span>
            </div>
          )}
        </div>

        {card.due_date && (
          <span className={`text-[10px] flex items-center gap-1 shrink-0 ${
            isOverdue ? "text-red-500 font-medium" : isDueToday ? "text-amber-500" : "text-muted-foreground"
          }`}>
            <CalendarDays className="h-3 w-3" />
            {format(new Date(card.due_date), "MMM d")}
          </span>
        )}
      </div>
    </div>
  );
}

function OverallDot({ status }: { status: CardStatus }) {
  const cls =
    status === "red" ? "bg-red-500"
    : status === "amber" ? "bg-amber-500"
    : status === "green" ? "bg-emerald-500"
    : status === "done" ? "bg-primary"
    : "bg-muted-foreground/50";
  const label =
    status === "not_started" ? "Not started"
    : status === "amber" ? "Yellow"
    : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`h-2 w-2 rounded-full ${cls}`} title={`Overall: ${label}`} />;
}
