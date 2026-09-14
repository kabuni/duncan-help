import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNormanChatContext } from "@/hooks/NormanChatContext";
import PendingWriteCard from "@/components/chat/PendingWriteCard";
import ToolStatusPills from "@/components/chat/ToolStatusPills";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Book a meeting with Sarah",
  "I'm off next Friday",
  "What's happening this week?",
  "Move my 3pm meeting",
  "Find me some focus time",
];

export function PlannerAsk({ onChanged }: { onChanged: () => void }) {
  const { messages, isLoading, pendingWrites, toolStatuses, send, confirmWrite, cancelWrite } =
    useNormanChatContext();
  const [input, setInput] = useState("");
  const [engaged, setEngaged] = useState(false);
  const wasLoading = useRef(false);

  useEffect(() => {
    if (wasLoading.current && !isLoading) onChanged();
    wasLoading.current = isLoading;
  }, [isLoading, onChanged]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  const submit = (text: string) => {
    const value = text.trim();
    if (!value || isLoading) return;
    setEngaged(true);
    setInput("");
    send(value, "general");
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card px-5 py-6 sm:px-8 sm:py-9">
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-foreground">
        What do you need to plan?
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Tell Duncan what's happening and he'll organise it for you.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-5"
      >
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={2}
            placeholder="e.g. Book a 30 minute review with Simon on Thursday afternoon"
            className="min-h-[76px] resize-none rounded-xl border-border/70 bg-background pr-14 text-base leading-relaxed shadow-none focus-visible:ring-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim()}
            className="absolute bottom-3 right-3 h-9 w-9 rounded-full"
            aria-label="Ask Duncan"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => submit(ex)}
            className="rounded-full border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-accent/50 hover:text-foreground"
          >
            {ex}
          </button>
        ))}
      </div>

      {(engaged || isLoading) && (
        <div className={cn("mt-5 border-t border-border/60 pt-4")}>
          <ToolStatusPills statuses={toolStatuses} />
          {isLoading && !lastAssistant?.content && (
            <p className="text-sm text-muted-foreground">Duncan is working on it…</p>
          )}
          {lastAssistant?.content && (
            <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">
              {lastAssistant.content}
            </div>
          )}
          {pendingWrites.length > 0 && (
            <div className="mt-3 space-y-2">
              {pendingWrites.map((p) => (
                <PendingWriteCard key={p.pendingId} pending={p} onConfirm={confirmWrite} onCancel={cancelWrite} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default PlannerAsk;
