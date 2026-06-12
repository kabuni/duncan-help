import {
  MessageSquare, Layers, LayoutDashboard, BookOpen, Calendar,
  User, Plug, Lightbulb, Bug, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ModuleSlide = {
  id: string;
  icon: LucideIcon;
  title: string;
  headline: string;
  body: string;
  examples?: string[];
  cta?: { label: string; to: string };
};

/** The 8 product modules introduced after onboarding and surfaced in /learn. */
export const MODULES: ModuleSlide[] = [
  {
    id: "chat",
    icon: MessageSquare,
    title: "Chat",
    headline: "Your fastest way into Duncan.",
    body:
      "Ask anything. Duncan retrieves information, searches meetings, accesses your knowledge, creates and manages work, and summarises across your tools. Chat should be your primary interface.",
    examples: [
      "Summarise this week's leadership meeting",
      "Create a workstream card for the new partner launch",
      "Find the latest investor update",
    ],
    cta: { label: "Open Chat", to: "/" },
  },
  {
    id: "projects",
    icon: Layers,
    title: "Projects",
    headline: "Strategic visibility into major initiatives.",
    body:
      "Projects are where goals, milestones, owners, timelines, and progress live. Use Projects to give leadership a clear view of major initiatives and outcomes.",
    cta: { label: "Open Projects", to: "/projects" },
  },
  {
    id: "workstreams",
    icon: LayoutDashboard,
    title: "Workstreams",
    headline: "The execution layer.",
    body:
      "Workstreams are where ongoing operational work is tracked. They connect daily execution to broader project goals through a kanban board with owners, status, and due dates.",
    cta: { label: "Open Workstreams", to: "/workstreams" },
  },
  {
    id: "knowledge-base",
    icon: BookOpen,
    title: "Knowledge Base",
    headline: "Duncan's organisational memory.",
    body:
      "Documents, policies, SOPs, meeting notes, and company knowledge are stored here and retrieved through Chat. The more you add, the better Duncan answers.",
    cta: { label: "Open Knowledge Base", to: "/knowledge-base" },
  },
  {
    id: "planner",
    icon: Calendar,
    title: "Planner",
    headline: "Priorities, deadlines, commitments.",
    body:
      "Planner helps you stay aligned on what's due, what's pending, and what's coming up — including approvals and key events.",
    cta: { label: "Open Planner", to: "/diary" },
  },
  {
    id: "profile",
    icon: User,
    title: "Profile",
    headline: "Personalise your Duncan experience.",
    body:
      "Manage your personal information, role context, and preferences. Profile data feeds directly into how Duncan responds to you.",
    cta: { label: "Open Settings", to: "/settings" },
  },
  {
    id: "integrations",
    icon: Plug,
    title: "Integrations",
    headline: "Connect the tools you use every day.",
    body:
      "Gmail, Calendar, and other connected services power many of Duncan's capabilities. Manage them in one place.",
    cta: { label: "Manage Integrations", to: "/integrations" },
  },
  {
    id: "feedback",
    icon: Lightbulb,
    title: "Feature Requests & Bug Reports",
    headline: "Help shape Duncan.",
    body:
      "Submit ideas, suggest improvements, and report issues from Settings. Your feedback drives what we build next and what we fix first.",
    cta: { label: "Open Feedback", to: "/feedback" },
  },
];

/** The 9-slide tour: intro + 8 module slides + closing. */
export type TourSlide = {
  id: string;
  icon: LucideIcon;
  title: string;
  headline: string;
  body: string;
  cta?: { label: string; to: string };
};

export const TOUR_SLIDES: TourSlide[] = [
  {
    id: "meet",
    icon: Sparkles,
    title: "Meet Duncan",
    headline: "Your AI teammate for the whole company.",
    body:
      "Duncan is your knowledge assistant, operations assistant, and project assistant — a single interface for information, projects, tasks, and workflows across the platform.",
  },
  ...MODULES.slice(0, 4).map((m) => ({
    id: m.id,
    icon: m.icon,
    title: m.title,
    headline: m.headline,
    body: m.body,
    cta: m.cta,
  })),
  ...MODULES.slice(4, 5).map((m) => ({
    id: m.id,
    icon: m.icon,
    title: m.title,
    headline: m.headline,
    body: m.body,
    cta: m.cta,
  })),
  {
    id: "personal",
    icon: User,
    title: "Settings & your personal workspace",
    headline: "Profile, Integrations, Feedback.",
    body:
      "Manage your profile, connect Gmail and Calendar, submit feature requests, and report bugs — all from Settings. Many Duncan capabilities depend on your connected integrations.",
    cta: { label: "Open Settings", to: "/settings" },
  },
  {
    id: "together",
    icon: Sparkles,
    title: "How it all fits together",
    headline: "One connected operating system.",
    body:
      "Chat is your primary interface. Projects give strategic visibility, Workstreams drive execution, Knowledge Base is memory, Planner manages priorities. Profile and Integrations personalise everything. Feedback closes the loop.",
  },
  {
    id: "ready",
    icon: Sparkles,
    title: "You're ready",
    headline: "Let's get to work.",
    body:
      "You can replay this tour anytime from Settings, or visit the Learn hub for a quick reference on every module.",
  },
];
