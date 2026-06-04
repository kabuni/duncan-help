export const KB_CATEGORIES = [
  "HR & People",
  "Legal & Compliance",
  "Finance",
  "Operations",
  "Product & Engineering",
  "Sales & Marketing",
  "Recruitment",
  "General / Company-Wide",
] as const;

export type KBCategory = (typeof KB_CATEGORIES)[number];

export const KB_SUBCATEGORIES: Record<KBCategory, string[]> = {
  "HR & People": ["Policies & Handbooks", "Benefits & Compensation", "Onboarding", "Leave & Attendance"],
  "Legal & Compliance": ["Company Formation", "Templates", "Data Protection & GDPR", "Regulatory & Licensing"],
  "Finance": ["Expense Policy & Claims", "Invoicing & Billing", "Budgets & Forecasts", "Tax & HMRC"],
  "Operations": ["SOPs & Playbooks", "Vendor & Supplier Info", "Office & Facilities"],
  "Product & Engineering": ["Architecture & Technical Docs", "Product Specs", "Engineering Standards", "Runbooks"],
  "Sales & Marketing": ["Brand Guidelines", "Pitch Decks", "Case Studies", "Pricing & Packaging", "Promotions"],
  "Recruitment": ["Job Descriptions", "Interview Scorecards", "Hiring Process", "Offer Letters"],
  "General / Company-Wide": ["Vision & Values", "OKRs", "Meeting Cadences", "Announcements"],
};

export const ACCEPTED_FILE_TYPES = ["pdf", "docx", "xlsx", "txt", "csv"] as const;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export function getFileType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}
