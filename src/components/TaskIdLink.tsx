import { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Canonical Task ID pattern. Task IDs are the single source of truth for
 * workstream cards (see workstream_cards.task_code, auto-assigned WS-XXXX).
 */
export const TASK_CODE_RE = /\b(WS-\d{4,})\b/g;

export function taskCodeHref(code: string): string {
  return `/workstreams?card=${encodeURIComponent(code)}`;
}

interface TaskIdLinkProps {
  code: string;
  className?: string;
  title?: string;
}

/**
 * Clickable Task ID chip. Renders as a link to the corresponding workstream
 * card. Safe to embed inside other clickable rows — swallows the click.
 */
export function TaskIdLink({ code, className, title }: TaskIdLinkProps) {
  return (
    <Link
      to={taskCodeHref(code)}
      onClick={(e) => e.stopPropagation()}
      title={title ?? `Open ${code}`}
      className={
        className ??
        "inline-flex items-center text-[10px] font-mono bg-secondary text-muted-foreground hover:text-primary hover:bg-secondary/80 transition-colors px-1.5 py-0.5 rounded"
      }
    >
      {code}
    </Link>
  );
}

/**
 * Turn plain text into a ReactNode that auto-linkifies any WS-XXXX task IDs.
 * Use this to render notification titles/bodies, comments, chat metadata, or
 * any other user-facing string that might reference a task.
 */
export function renderWithTaskLinks(text: string | null | undefined): ReactNode {
  if (!text) return text ?? null;
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  const re = new RegExp(TASK_CODE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    parts.push(
      <TaskIdLink
        key={`${match[0]}-${match.index}`}
        code={match[1]}
        className="font-mono text-primary hover:underline"
      />,
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx === 0) return text;
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

/** Extract the first Task ID from a string, or null. */
export function extractTaskCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b(WS-\d{4,})\b/);
  return m ? m[1] : null;
}
