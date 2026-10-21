import type { Facets } from "./facets";
import type { FieldKey } from "./fields.ts";

/** "lineup" is chosen in code from the plan, never offered to Jev as a view. */
export const VIEWS = ["single", "scene", "compare", "scale", "similar", "lineup", "none"] as const;
export const COUNTS = ["one", "many_separate", "group", "unclear"] as const;
export const SUBJECTS = ["prop", "depiction", "creature", "nature", "structure", "unclear"] as const;

export const SCOPES = ["all", "some"] as const;
export const SORTS = ["relevance", "size_desc", "size_asc", "modified_desc", "modified_asc", "last_author", "created_desc", "created_asc", "name"] as const;
export const WINDOWS = ["any", "today", "this_week", "this_month", "this_year"] as const;

export type View = (typeof VIEWS)[number];
export type Count = (typeof COUNTS)[number];
export type Subject = (typeof SUBJECTS)[number];
export type Scope = (typeof SCOPES)[number];
export type Sort = (typeof SORTS)[number];
export type Window = (typeof WINDOWS)[number];

/** What to do with the matching set. Jev classifies; author and facets are matched in code against catalog values. */
export type Plan = {
  /** The words that describe the assets, without sort, layout, date or person instructions. */
  about: string;
  scope: Answer<Scope>;
  sort: Answer<Sort>;
  window: Answer<Window>;
  /** Probability the artist wants the set side by side at real size rather than as a grid. */
  sideBySide: number;
  author: string | null;
  facets: Facets;
  /** Probability the text wants everything that passes its filters, naming no kind of asset. */
  browse: number;
  groupBy: Answer<FieldKey | "none">;
};

export const TURNS = ["new", "refine", "act"] as const;
export const ACTIONS = ["none", "add_to_cart", "create_collection", "line_up"] as const;
export type Turn = (typeof TURNS)[number];
export type Action = (typeof ACTIONS)[number];

/** How a line relates to the results already on screen. Only asked when there are results to build on. */
export type FollowUp = {
  turn: Answer<Turn>;
  /** Probability the line asks for a look or physical detail the shown assets must have. */
  narrows: number;
  /** "just the 3 smallest" → 3. Jev flags the count word; code reads the number. */
  limit: number | null;
};

export type Answer<T extends string> = {
  value: T;
  confidence: number;
  probabilities: Partial<Record<T, number>>;
};

export type Intent = {
  view: Answer<View>;
  count: Answer<Count>;
  subject: Answer<Subject>;
  /** Probability the query describes appearance: colour, material, condition, contents. */
  visual: number;
  /** Probability the query names an animal without saying living animal or object shaped like one. Absent offline. */
  animalUnsaid?: number;
  plan: Plan;
  /** Something to do with the assets found: "add all barrels to cart", "make a collection of these". Absent offline. */
  action?: Answer<Action>;
  followUp?: FollowUp;
  source: "jev" | "offline";
  /** Set when the local router answered view and count, behind `?router=local`. Everything else still comes from `source`. */
  router?: "local";
  model: string;
  latencyMs: number;
};

/** Act on a decision only above this confidence; below it, ask. */
export const ACT_THRESHOLD = 0.6;

/** Labels whose probability is close enough to the top choice to be worth offering. */
export function contenders<T extends string>(a: Answer<T>, min = 0.2): T[] {
  return (Object.entries(a.probabilities) as [T, number][])
    .filter(([, p]) => p >= min)
    .sort((x, y) => y[1] - x[1])
    .map(([k]) => k);
}
