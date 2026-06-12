import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, X, Check, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { TOUR_SLIDES } from "./moduleContent";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";

export default function MeetDuncanTour({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  if (!open) return null;

  const slide = TOUR_SLIDES[index];
  const isFirst = index === 0;
  const isLast = index === TOUR_SLIDES.length - 1;

  const markComplete = async () => {
    if (user) {
      await supabase
        .from("profiles")
        .update({ meet_duncan_tour_completed_at: new Date().toISOString() } as any)
        .eq("user_id", user.id);
      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    }
  };

  const handleClose = async () => {
    await markComplete();
    onClose();
  };

  const handleNext = async () => {
    if (isLast) {
      await handleClose();
      return;
    }
    setIndex((i) => i + 1);
  };

  const Icon = slide.icon;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-background/85 backdrop-blur-sm"
        onClick={handleClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative z-10 w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg overflow-hidden border border-primary/20">
              <img
                src={duncanAvatar}
                alt="Duncan"
                className="h-full w-full object-cover object-[50%_30%] scale-150"
              />
            </div>
            <span className="text-xs font-semibold tracking-tight text-foreground">
              Meet Duncan
            </span>
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs flex items-center gap-1"
            aria-label="Skip tour"
          >
            Skip <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="px-5 pt-3 flex gap-1.5">
          {TOUR_SLIDES.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= index ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="px-6 pt-8 pb-6 min-h-[280px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                <Icon className="h-6 w-6" />
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
                {slide.title}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-3">
                {slide.headline}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {slide.body}
              </p>
              {slide.cta && (
                <button
                  onClick={async () => {
                    await markComplete();
                    onClose();
                    navigate(slide.cta!.to);
                  }}
                  className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  {slide.cta.label} <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={isFirst}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="text-[10px] text-muted-foreground/70">
            {index + 1} of {TOUR_SLIDES.length}
          </div>
          <button
            onClick={handleNext}
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
    </div>
  );
}
