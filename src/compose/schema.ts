import { z } from "zod/v4";

/**
 * The parts a composed results page is built from. Shared by the server (prompt) and the client (renderer); each passes
 * its own `defineComponent` and `createLibrary`, because react-lang bundles its own copy of lang-core.
 */
type Define = (c: { name: string; description: string; props: z.ZodObject; component: unknown }) => { ref: z.ZodType };
type Create = (l: { components: unknown[]; root: string }) => unknown;
export type Renderers = Record<"Results" | "Group" | "Lineup" | "Pick" | "Facet" | "Value", unknown>;

const refs = z.array(z.number()).describe("Asset numbers from the list, best first");

export function makeLibrary<L>(defineComponent: Define, createLibrary: Create, r: Renderers): L {
  const Group = defineComponent({
    name: "Group",
    description: "A titled set of assets an artist would choose between, laid out as a grid.",
    props: z.object({ title: z.string().describe("1 to 3 plain words, e.g. 'With arms', 'Rusty', 'Low stools'"), assets: refs }),
    component: r.Group,
  });
  const Lineup = defineComponent({
    name: "Lineup",
    description: "Assets drawn to real size next to a person, for size questions and comparing heights.",
    props: z.object({ title: z.string(), assets: refs }),
    component: r.Lineup,
  });
  const Pick = defineComponent({
    name: "Pick",
    description: "One asset that clearly answers a specific search, shown large.",
    props: z.object({ asset: z.number().describe("One asset number"), why: z.string().describe("Under 8 words, what about it fits") }),
    component: r.Pick,
  });
  const Value = defineComponent({
    name: "Value",
    description: "One answer to a facet question and every asset that has it.",
    props: z.object({ label: z.string().describe("1 to 3 plain words, e.g. 'With arms', 'Round', 'Bare wood'"), assets: refs }),
    component: r.Value,
  });
  const Facet = defineComponent({
    name: "Facet",
    description: "A visible difference in these assets that the list fields do not already cover.",
    props: z.object({
      label: z.string().describe("The question in 1 to 2 plain words, e.g. 'Arms', 'Shape', 'Finish'"),
      values: z.array(Value.ref).describe("2 to 4 values"),
    }),
    component: r.Facet,
  });
  const Results = defineComponent({
    name: "Results",
    description: "The whole page of results for one search.",
    props: z.object({
      parts: z.array(z.union([Group.ref, Lineup.ref, Pick.ref])),
      next: z.array(z.string()).describe("2 to 4 short follow-ups the artist might type next, from real differences in these assets").optional(),
      facets: z.array(Facet.ref).describe("1 to 3 optional filters on visible differences not already in the list fields").optional(),
    }),
    component: r.Results,
  });
  return createLibrary({ components: [Results, Group, Lineup, Pick, Facet, Value], root: "Results" }) as L;
}

export const FACET_RULES = [
  "Facets are what an artist checks when picking one of these: parts, shape and build that belong to what was searched, like arms or a back on chairs, a shade or a stand on lamps, leaves or bare branches on trees, lids or hoops on barrels. Prefer those to material, color, style or era. Never author, show, status, dates, type or collection.",
  "Each facet has 2 to 4 values, and each value lists every asset number that has it, at least 2. An asset may be in no value. Leave facets out rather than add one most assets share or one you have to guess at.",
  "A facet never splits the assets the way the groups already do, and no follow-up in next asks for a facet value.",
];

export const RULES = [
  "Use only asset numbers from the list. Use each number at most once.",
  "Leave out assets that are not what the search asks for.",
  'If the search says how to group, in any words, group only that way and title each group by its value, like "Green" and "Red", or "Ana" and "Ben", never by the grouping itself like "By color". Group by anything the list says about the assets: who made or changed them, when, show, status, type, collection, color, era, material. Era and period mean the time an asset depicts, read from its look and description, not when it was added. If that makes more than 5 groups, keep the 4 biggest and put the rest in "Other".',
  'If the list says nothing about what the search groups by, group by the closest thing it does say and make the first title say so, like "No color listed, by material: Wood".',
  "Otherwise group by what an artist picks between: form, style, material, condition or size. 2 to 5 groups, the best group first.",
  "Titles are plain studio words. No marketing words, no emoji, no counts.",
  "Use Lineup only when the search is about size or comparing heights. Use Pick only when one asset clearly answers a specific search.",
  'A search like "chairs, then only the wooden ones" is a follow-up. Apply the last step to the ones before it: narrow, reorder, or add what it asks for. Keep group titles from earlier steps when they still fit, unless the last step says how to group: then regroup only the last step\'s way and drop earlier groupings.',
  'When the search asks for a material or finish that assets can have only in part, like "wooden ones", split into a group made all of it and a group that mixes it with something else, titled by the other material, like "All wood" and "Wood and leather".',
  "Follow-ups in next build on the search so far. Never repeat a group title or a follow-up already in the search.",
  ...FACET_RULES,
  "Write root first, then each part on its own line, so the page streams in order. Positional arguments only, never name=value.",
];
