// Shared category metadata for the Planner / Diary.
// Each category gets a stable color (HSL) used for borders, dots and legend chips.
// Risk-level still drives the event background fill; category drives the left
// stripe + icon so both signals are visible at once.

export type CategoryMeta = {
  label: string;
  icon: string;
  // HSL triplet (no hsl() wrapper) so we can use it with hsl(var()) patterns.
  hsl: string;
};

export const CATEGORY_META: Record<string, CategoryMeta> = {
  Travel:     { label: "Travel",     icon: "✈️", hsl: "210 85% 55%" },
  Holiday:    { label: "Holiday",    icon: "🏖️", hsl: "180 65% 45%" },
  Marketing:  { label: "Marketing",  icon: "📣", hsl: "330 75% 55%" },
  Launch:     { label: "Launch",     icon: "🚀", hsl: "12 85% 55%"  },
  Investor:   { label: "Investor",   icon: "💼", hsl: "260 60% 55%" },
  Product:    { label: "Product",    icon: "🛠️", hsl: "200 75% 50%" },
  Operations: { label: "Operations", icon: "⚙️", hsl: "220 15% 45%" },
  Releases:   { label: "Releases",   icon: "📦", hsl: "30 85% 50%"  },
  Communication: { label: "Communication", icon: "💬", hsl: "150 60% 45%" },
  Social:     { label: "Social",     icon: "📱", hsl: "290 70% 55%" },
  Creative:   { label: "Creative",   icon: "🎨", hsl: "45 90% 55%"  },
  Event:      { label: "Event",      icon: "📌", hsl: "240 10% 50%" },
};

const FALLBACK: CategoryMeta = { label: "Other", icon: "📌", hsl: "240 10% 50%" };

export function getCategoryMeta(category?: string | null): CategoryMeta {
  if (!category) return FALLBACK;
  return CATEGORY_META[category] || FALLBACK;
}

export const CATEGORY_LIST = Object.keys(CATEGORY_META);
