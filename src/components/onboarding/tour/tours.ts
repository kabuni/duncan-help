import type { TourDefinition } from "./types";

export const TOURS: Record<string, TourDefinition> = {
  projects: {
    id: "projects",
    name: "Projects tour",
    description: "Isolated AI workspaces with persistent context, files, and custom instructions.",
    eta: "~2 min",
    route: "/projects",
    steps: [
      {
        target: "nav-projects",
        title: "Projects live here",
        body: "Projects are dedicated AI workspaces — one per initiative — with their own chats, files and system prompt.",
        route: "/projects",
        placement: "right",
      },
      {
        target: "projects-new",
        title: "Create a project",
        body: "Give it a name and (optionally) custom instructions that Duncan follows inside this workspace.",
        placement: "bottom",
      },
      {
        target: "projects-list",
        title: "Your projects",
        body: "Every project you create or are invited to appears here. Click one to open its workspace.",
        placement: "top",
      },
      {
        target: "nav-learn",
        title: "Come back anytime",
        body: "You can replay this walkthrough from Learn Duncan whenever you want a refresher.",
        placement: "top",
      },
    ],
  },
  workstreams: {
    id: "workstreams",
    name: "Workstreams tour",
    description: "The execution layer: Kanban cards, tasks, assignees, and RYG status tracking.",
    eta: "~3 min",
    route: "/workstreams",
    steps: [
      {
        target: "nav-workstreams",
        title: "Workstreams",
        body: "Track ongoing operational work as cards on a Kanban board, grouped by RYG status.",
        route: "/workstreams",
        placement: "right",
      },
      {
        target: "ws-new-card",
        title: "Create a card",
        body: "New Card opens the card composer. Add a title, assignees, tags, tasks and a target date.",
        placement: "bottom",
      },
      {
        target: "ws-board",
        title: "The Kanban board",
        body: "Green = on track, Yellow = at risk, Red = off track. Only 10 cards show per column — use the pager at the bottom of each column.",
        placement: "top",
      },
      {
        target: "ws-present",
        title: "Presentation mode",
        body: "Open a full-screen view of the board for standups and leadership reviews.",
        placement: "bottom",
      },
    ],
  },
  planner: {
    id: "planner",
    name: "Planner tour",
    description: "Your unified calendar: Google events, key events, workstream deadlines and RSVPs.",
    eta: "~2 min",
    route: "/diary",
    steps: [
      {
        target: "nav-diary",
        title: "The Planner",
        body: "A single calendar for meetings, key events and workstream deadlines — synced with Google Calendar.",
        route: "/diary",
        placement: "right",
      },
      {
        target: "planner-add-event",
        title: "Add an event",
        body: "Create a key event, tag it, and (if connected) push it to Google Calendar in one step.",
        placement: "bottom",
      },
      {
        target: "planner-calendar",
        title: "Your unified view",
        body: "Click any event to open its detail drawer — attendees, attachments, RSVPs and approvals live there.",
        placement: "top",
      },
    ],
  },
};

export const TOUR_LIST = Object.values(TOURS);
