import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, X, Check } from "lucide-react";
import type { TourStep } from "./types";

type Rect = { top: number; left: number; width: number; height: number };

const findTarget = (id: string): HTMLElement | null =>
  document.querySelector(`[data-tour="${id}"]`) as HTMLElement | null;

export function TourOverlay({
  step,
  index,
  total,
  onNext,
  onBack,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [waiting, setWaiting] = useState(true);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const padding = step.spotlightPadding ?? 8;

  // Poll for the target element (up to ~6s) then track its rect.
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let attempts = 0;
    const measure = () => {
      const el = findTarget(step.target);
      if (!el) {
        attempts++;
        if (attempts < 60 && !cancelled) {
          setWaiting(true);
          setTimeout(() => (raf = requestAnimationFrame(measure)), 100);
        }
        return;
      }
      setWaiting(false);
      el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const onResize = () => {
      const el = findTarget(step.target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const interval = setInterval(onResize, 300);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      clearInterval(interval);
    };
  }, [step.target]);

  // Compute tooltip position
  const tooltipPos = (() => {
    if (!rect) return { top: window.innerHeight / 2 - 100, left: window.innerWidth / 2 - 160 };
    const tw = 340;
    const th = 200;
    const gap = 14;
    const placement =
      step.placement && step.placement !== "auto"
        ? step.placement
        : rect.top > th + 40
        ? "top"
        : "bottom";
    let top = rect.top + rect.height + gap;
    let left = rect.left + rect.width / 2 - tw / 2;
    if (placement === "top") top = rect.top - th - gap;
    if (placement === "left") {
      top = rect.top + rect.height / 2 - th / 2;
      left = rect.left - tw - gap;
    }
    if (placement === "right") {
      top = rect.top + rect.height / 2 - th / 2;
      left = rect.left + rect.width + gap;
    }
    // Clamp
    left = Math.max(12, Math.min(window.innerWidth - tw - 12, left));
    top = Math.max(12, Math.min(window.innerHeight - th - 12, top));
    return { top, left, width: tw };
  })();

  const W = typeof window !== "undefined" ? window.innerWidth : 1024;
  const H = typeof window !== "undefined" ? window.innerHeight : 768;

  return createPortal(
    <div className="fixed inset-0 z-[70]" aria-live="polite">
      {/* SVG mask spotlight */}
      <svg width={W} height={H} className="absolute inset-0 pointer-events-none">
        <defs>
          <mask id="tour-mask">
            <rect x={0} y={0} width={W} height={H} fill="white" />
            {rect && (
              <rect
                x={rect.left - padding}
                y={rect.top - padding}
                width={rect.width + padding * 2}
                height={rect.height + padding * 2}
                rx={10}
                ry={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="hsl(var(--background) / 0.72)"
          mask="url(#tour-mask)"
          style={{ pointerEvents: "auto" }}
        />
        {rect && (
          <rect
            x={rect.left - padding}
            y={rect.top - padding}
            width={rect.width + padding * 2}
            height={rect.height + padding * 2}
            rx={10}
            ry={10}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            className="animate-pulse"
          />
        )}
      </svg>

      <AnimatePresence mode="wait">
        <motion.div
          key={step.target}
          ref={tooltipRef}
          initial={{ opacity: 0, scale: 0.98, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -4 }}
          transition={{ duration: 0.18 }}
          className="absolute z-10 rounded-xl border border-border bg-card shadow-2xl p-5"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
            width: `min(${tooltipPos.width}px, calc(100vw - 24px))`,
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Step {index + 1} of {total}
            </div>
            <button
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground transition-colors -mt-1 -mr-1 p-1"
              aria-label="Skip tour"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1.5 tracking-tight">
            {step.title}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {waiting ? "Locating the right element…" : step.body}
          </p>

          {/* Progress bar */}
          <div className="h-1 w-full bg-border rounded-full overflow-hidden mt-4 mb-3">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((index + 1) / total) * 100}%` }}
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={onBack}
              disabled={isFirst}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            <button
              onClick={onSkip}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip
            </button>
            <button
              onClick={onNext}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {isLast ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Finish
                </>
              ) : (
                <>
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body
  );
}
