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
  Travel:     { label: "Travel",       icon: "✈️", hsl: "210 85% 55%" },
  Holiday:    { label: "Annual Leave", icon: "🏖️", hsl: "180 65% 45%" },
  GlobalAllHands: { label: "Global All Hands", icon: "🌐", hsl: "215 70% 50%" },
  TeamSocials: { label: "Team Socials", icon: "🥂", hsl: "300 65% 55%" },
  Product:    { label: "Product",      icon: "🛠️", hsl: "200 75% 50%" },
  Releases:   { label: "Releases",     icon: "📦", hsl: "30 85% 50%"  },
  Event:      { label: "Event",        icon: "📌", hsl: "240 10% 50%" },
  "Super Coaches": { label: "Super Coaches", icon: "🏆", hsl: "165 70% 40%" },
  Investor:   { label: "Investor",     icon: "💼", hsl: "260 60% 55%" },
  Social:     { label: "Social Media", icon: "📱", hsl: "290 70% 55%" },
  PR:         { label: "PR",           icon: "📰", hsl: "20 80% 50%"  },
  Launch:     { label: "Launches",     icon: "🚀", hsl: "12 85% 55%"  },
  Marketing:  { label: "Marketing",    icon: "📣", hsl: "330 75% 55%" },
  Operations: { label: "Operations",   icon: "⚙️", hsl: "220 15% 45%" },
  Communication: { label: "Communication", icon: "💬", hsl: "150 60% 45%" },
  Creative:   { label: "Creative",     icon: "🎨", hsl: "45 90% 55%"  },
  BusinessDevelopment: { label: "Business Development", icon: "🤝", hsl: "140 60% 40%" },
};

export const CATEGORY_GROUPS: { label: string; keys: string[] }[] = [
  { label: "People",     keys: ["Travel", "Holiday", "GlobalAllHands", "TeamSocials"] },
  { label: "Operations", keys: ["Product", "Releases", "Event", "Super Coaches", "Investor"] },
  { label: "Marketing",  keys: ["Social", "PR", "Launch"] },
  { label: "Other",      keys: ["Marketing", "Operations", "Communication", "Creative", "BusinessDevelopment"] },
];

const FALLBACK: CategoryMeta = { label: "Other", icon: "📌", hsl: "240 10% 50%" };

export function getCategoryMeta(category?: string | null): CategoryMeta {
  if (!category) return FALLBACK;
  return CATEGORY_META[category] || FALLBACK;
}

export const CATEGORY_LIST = Object.keys(CATEGORY_META);
