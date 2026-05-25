import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PanelRightClose, PanelRightOpen, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkstreamCards } from "@/hooks/useWorkstreams";
import { useKeyEvents } from "@/hooks/useKeyEvents";
import { useApprovals } from "@/hooks/useApprovals";
import { useGeneralChatsContext } from "@/hooks/GeneralChatsContext";

interface SectionProps {
  title: string;
  children: React.ReactNode;
}
const Section = ({ title, children }: SectionProps) => (
  <div className="space-y-2">
    <h3 className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
      {title}
    </h3>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const Pill = ({ tone, children }: { tone: "red" | "amber" | "green" | "muted"; children: React.ReactNode }) => {
  const cls = {
    red: "bg-red-500/15 text-red-600 dark:text-red-400",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", cls)}>{children}</span>;
};

const Row = ({ label, right, onClick }: { label: string; right?: React.ReactNode; onClick?: () => void }) => (
  <button
    onClick={onClick}
    className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-secondary/60 transition-colors"
  >
    <span className="truncate">{label}</span>
    <span className="shrink-0 flex items-center gap-1.5">{right}</span>
  </button>
);

const HomeContext = () => {
  const navigate = useNavigate();
  const { data: cards = [] } = useWorkstreamCards();
  const { events } = useKeyEvents();
  const { data: approvals = [] } = useApprovals();

  const red = cards.filter(c => c.status === "red").length;
  const amber = cards.filter(c => c.status === "amber").length;
  const green = cards.filter(c => c.status === "green").length;

  const now = new Date();
  const upcoming = events
    .filter(e => new Date(e.starts_at) >= now)
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
    .slice(0, 3);

  const pending = approvals.filter(a => a.status === "pending").slice(0, 3);

  return (
    <>
      <Section title="Workstream pulse">
        <Row label="Red" right={<Pill tone="red">{red}</Pill>} onClick={() => navigate("/workstreams")} />
        <Row label="Amber" right={<Pill tone="amber">{amber}</Pill>} onClick={() => navigate("/workstreams")} />
        <Row label="Green" right={<Pill tone="green">{green}</Pill>} onClick={() => navigate("/workstreams")} />
      </Section>

      <Section title="Upcoming">
        {upcoming.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">Nothing scheduled.</p>
        ) : (
          upcoming.map(e => (
            <Row
              key={e.id}
              label={e.title}
              right={<span className="text-[10px] text-muted-foreground">
                {new Date(e.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>}
              onClick={() => navigate("/diary")}
            />
          ))
        )}
      </Section>

      <Section title="Pending approvals">
        {pending.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">All clear.</p>
        ) : (
          pending.map(a => (
            <Row
              key={a.id}
              label={a.title}
              right={<Pill tone="amber">{a.kind}</Pill>}
              onClick={() => navigate("/approvals")}
            />
          ))
        )}
      </Section>
    </>
  );
};

const ChatContext = () => {
  const chatOps = useGeneralChatsContext();
  const navigate = useNavigate();
  const recent = chatOps.chats.slice(0, 6);

  return (
    <>
      <Section title="Recent threads">
        {recent.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No conversations yet.</p>
        ) : (
          recent.map(c => (
            <Row
              key={c.id}
              label={c.title || "Untitled chat"}
              onClick={() => {
                chatOps.setActiveChatId(c.id);
                navigate("/");
              }}
            />
          ))
        )}
      </Section>
      <Section title="Tips">
        <p className="px-2 text-[11px] leading-5 text-muted-foreground">
          Use <kbd className="rounded border border-border bg-muted px-1 text-[10px]">⌘K</kbd> to jump anywhere or ask Duncan a quick question.
        </p>
      </Section>
    </>
  );
};

const WorkstreamsContext = () => {
  const navigate = useNavigate();
  const { data: cards = [] } = useWorkstreamCards();
  const red = cards.filter(c => c.status === "red");
  const overdue = cards.filter(c => c.due_date && new Date(c.due_date) < new Date() && c.status !== "done");

  return (
    <>
      <Section title="Critical">
        {red.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No red cards.</p>
        ) : (
          red.slice(0, 5).map(c => (
            <Row key={c.id} label={c.title} right={<Pill tone="red">red</Pill>} />
          ))
        )}
      </Section>
      <Section title="Overdue">
        {overdue.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">Nothing overdue.</p>
        ) : (
          overdue.slice(0, 5).map(c => (
            <Row key={c.id} label={c.title} right={<Pill tone="amber">late</Pill>} />
          ))
        )}
      </Section>
      <Section title="Jump">
        <Row label="Planner" right={<ArrowRight className="h-3 w-3" />} onClick={() => navigate("/diary")} />
        <Row label="Approvals" right={<ArrowRight className="h-3 w-3" />} onClick={() => navigate("/approvals")} />
      </Section>
    </>
  );
};

const PlannerContext = () => {
  const navigate = useNavigate();
  const { events } = useKeyEvents();
  const today = new Date();
  const todayKey = today.toDateString();
  const todays = events.filter(e => new Date(e.starts_at).toDateString() === todayKey);
  const upcoming = events
    .filter(e => new Date(e.starts_at) > today && new Date(e.starts_at).toDateString() !== todayKey)
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
    .slice(0, 5);

  return (
    <>
      <Section title="Today">
        {todays.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">Nothing today.</p>
        ) : (
          todays.map(e => (
            <Row
              key={e.id}
              label={e.title}
              right={<span className="text-[10px] text-muted-foreground">
                {new Date(e.starts_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </span>}
            />
          ))
        )}
      </Section>
      <Section title="Coming up">
        {upcoming.map(e => (
          <Row
            key={e.id}
            label={e.title}
            right={<span className="text-[10px] text-muted-foreground">
              {new Date(e.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>}
          />
        ))}
      </Section>
      <Section title="Jump">
        <Row label="Approvals" right={<ArrowRight className="h-3 w-3" />} onClick={() => navigate("/approvals")} />
      </Section>
    </>
  );
};

const ApprovalsContext = () => {
  const { data: approvals = [] } = useApprovals();
  const pending = approvals.filter(a => a.status === "pending");
  const recent = approvals.slice(0, 5);
  return (
    <>
      <Section title="Pending">
        <Row label={`${pending.length} awaiting decision`} right={<Pill tone="amber">{pending.length}</Pill>} />
      </Section>
      <Section title="Recent activity">
        {recent.map(a => (
          <Row key={a.id} label={a.title} right={<Pill tone="muted">{a.status}</Pill>} />
        ))}
      </Section>
    </>
  );
};

const DefaultContext = () => (
  <Section title="Tips">
    <p className="px-2 text-[11px] leading-5 text-muted-foreground">
      Press <kbd className="rounded border border-border bg-muted px-1 text-[10px]">⌘K</kbd> to search,
      navigate, or ask Duncan from anywhere.
    </p>
  </Section>
);

const routeMeta = (path: string): { title: string; node: React.ReactNode } => {
  if (path === "/") return { title: "Home", node: <HomeContext /> };
  if (path.startsWith("/workstreams")) return { title: "Workstreams", node: <WorkstreamsContext /> };
  if (path.startsWith("/diary")) return { title: "Planner", node: <PlannerContext /> };
  if (path.startsWith("/approvals")) return { title: "Approvals", node: <ApprovalsContext /> };
  if (path.startsWith("/projects")) return { title: "Projects", node: <ChatContext /> };
  return { title: "Context", node: <DefaultContext /> };
};

export const ContextRail = () => {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { title, node } = routeMeta(pathname);

  return (
    <>
      {/* Toggle handle — always visible on desktop */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "hidden lg:flex fixed top-3 z-40 h-8 w-8 items-center justify-center rounded-md border border-border bg-background/80 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-secondary transition-all",
          open ? "right-[19rem]" : "right-14"
        )}
        title={open ? "Hide context" : "Show context"}
      >
        {open ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
      </button>

      {/* Rail */}
      <aside
        className={cn(
          "hidden lg:flex fixed right-0 top-0 z-30 h-screen w-72 flex-col border-l border-border bg-sidebar transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-foreground">{title}</h2>
            <p className="text-[10px] font-mono tracking-widest text-muted-foreground">CONTEXT</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {node}
        </div>
      </aside>
    </>
  );
};
