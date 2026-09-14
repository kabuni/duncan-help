/**
 * Intended production structure for the Projects experience.
 *
 * IMPORTANT: this is reference/placeholder metadata ONLY — it is never written to the
 * database and no workstream card here is created, copied or mocked in this environment.
 * The real cards live in the production Duncan environment (prod.duncan.kabuni.com) and
 * remain the single source of truth.
 *
 * When Projects ships to production, the mapping below is applied purely by setting
 * `workstream_cards.project_id` on the EXISTING cards. Nothing is duplicated: WS ids,
 * task ids, owners, co-owners, due dates, priority, RYG status, completion dates and
 * activity history all stay on the original records.
 */

export type MappedArea = {
  /** Existing production workstream card code — never created here. */
  code: string;
  /** Card title as it exists in production. */
  title: string;
  /** Why this card sits where it does. */
  note?: string;
};

export type MappedProject = {
  name: string;
  /** The card that represents the initiative itself, if there is one. */
  originCode?: string;
  areas: MappedArea[];
};

export const PRODUCTION_PROJECT_MAP: MappedProject[] = [
  {
    name: "Kabuni School Premier League",
    originCode: "WS-0299",
    areas: [{ code: "WS-0299", title: "Kabuni School Premier League", note: "Card is the whole initiative" }],
  },
  {
    name: "Founder Story + Social",
    originCode: "WS-0290",
    areas: [{ code: "WS-0290", title: "Founder Story + Social", note: "Card is the whole initiative" }],
  },
  {
    name: "K10 App",
    originCode: "WS-0274",
    areas: [{ code: "WS-0274", title: "K10 App", note: "Card is the whole initiative" }],
  },
  {
    name: "Cricket MVP App",
    originCode: "WS-0292",
    areas: [{ code: "WS-0292", title: "Develop the Cricket MVP App" }],
  },
  {
    name: "Road to 400",
    areas: [
      { code: "WS-0252", title: "School Integration", note: "Area of work inside the project" },
      { code: "WS-0293", title: "Partner School Webinars w Super Coaches", note: "Area of work inside the project" },
    ],
  },
  {
    name: "Duncan AI",
    originCode: "WS-0104",
    areas: [{ code: "WS-0104", title: "Duncan AI", note: "Card is the whole initiative" }],
  },
];

/** Cards deliberately left out of the initial mapping. */
export const PRODUCTION_UNMAPPED: MappedArea[] = [
  {
    code: "WS-0297",
    title: "Follow up with USP Jain School for contract signing",
    note: "Already Done — kept as history, not an active project",
  },
];
