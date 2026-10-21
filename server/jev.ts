import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import type { Action, Answer, FollowUp, Intent, Turn } from "../src/intent.ts";
import { FIELDS, GROUP_BY_HINTS, GROUP_KEYS, type FieldKey } from "../src/fields.ts";
import { readFacets, stripFacets } from "../src/facets.ts";
import { matchAuthor } from "./authors.ts";
import holds from "../embed/vision/holds.json" with { type: "json" };
import type { Holds } from "../src/multiplicity.ts";

/**
 * Jev answers every question in parallel against the same text. Criteria are
 * self-contained, non-overlapping and each has an escape option. Jev never
 * extracts values: asset names for compare/scale are parsed in code.
 */
export const questions = {
  view: choice("What the artist wants to see from this asset library search", {
    single: "One kind of asset, e.g. a chair, a dog skeleton, a red spoon",
    scene: "A set of different assets that belong together for a scene, place, theme or occasion",
    compare: "Two or more named assets shown side by side to compare them",
    scale: "How big an asset is, or its size next to a person or another asset",
    similar: "More assets that look like an asset they already have",
    none: "Too short, unclear or unfinished to tell yet",
  }),
  count: choice("How many of the thing the artist wants", {
    one: "A single object, e.g. 'a chair', 'barrel'",
    many_separate: "Several separate assets of one kind, to pick from or place individually",
    group: "One asset that is itself a group or arrangement, e.g. 'a pile of rocks', 'stack of books'",
    unclear: "Plural or vague: could mean several separate assets or one grouped asset",
  }),
  subject: choice("What kind of thing the asset is", {
    prop: "A manmade object or prop",
    depiction: "An object made to look like a living thing: a toy, statue, skeleton or stuffed animal",
    creature: "A living animal or creature",
    nature: "A plant, tree, rock or other natural element",
    structure: "A building, room or large structure",
    unclear: "Not clear from the text",
  }),
  visual: noul("The text describes how the asset should look: its colour, material, condition, or what it contains"),
  scope: choice("Whether the artist wants every matching asset or a few to choose from", {
    all: "Every asset of that kind in the library, e.g. 'all lamps', 'every wooden tool', 'sort chairs by size'",
    some: "A few good options to pick from, e.g. 'a red spoon', 'wooden chair with arms'",
  }),
  sort: choice("How the artist wants the results ordered", {
    relevance: "No order asked for, or the search asks to group them rather than order them, like 'grouped by color', 'one row per era' or 'chairs by who made them'",
    size_desc: "By size, biggest or tallest first, or just 'by size'",
    size_asc: "By size, smallest or shortest first",
    modified_desc: "Most recently changed, edited or updated first",
    modified_asc: "Least recently changed or updated first",
    last_author: "By who last changed it, the last author",
    created_desc: "Newest, most recently added or published first",
    created_asc: "Oldest, first added first",
    name: "Alphabetically by name",
  }),
  window: choice("A time limit on when the assets were changed or added", {
    any: "No time limit",
    today: "Today",
    this_week: "This week or the last few days",
    this_month: "This month or the last few weeks",
    this_year: "This year or the last few months",
  }),
  arrangement: choice("How the artist wants the assets laid out", {
    list: "A list or grid to browse, e.g. 'all lamps', 'sort lamps by size', 'newest chairs'",
    side_by_side: "Lined up next to each other to compare, e.g. 'compare all lamps by size', 'lamps side by side'",
  }),
  person: noul("The text names a person who made or changed the assets"),
  browse: noul(
    "The text asks for every asset that passes a filter (a show, approval status, date or person) without naming a kind of asset, e.g. 'everything approved on Night Shift this week', 'assets changed today'. 'approved chairs' and 'props by Kirill' name a kind.",
  ),
  groupBy: choice("How the artist wants the results grouped or laid out in rows", {
    none: "No grouping by field: only sort order is asked, or the line just keeps a narrower kind of asset, e.g. 'only the cookware'",
    ...Object.fromEntries(GROUP_KEYS.map((k) => [k, `${FIELDS[k].label}: ${GROUP_BY_HINTS[k]}`])),
  } as Record<FieldKey | "none", string>),
  animalUnsaid: noul(
    "The text names an animal but doesn't say whether it means the living animal or an object shaped like one (a statue, toy, mounted head). 'horse' and 'owls' do; 'horse statue', 'a galloping horse' and 'rubber duck' don't.",
  ),
};

const ACTION = choice("What the artist wants done with the assets", {
  none: "Nothing; it's a search or a change to which assets show",
  add_to_cart: "Add them to the cart",
  create_collection: "Make or save a collection of them",
  line_up: "Line them up, compare them side by side, or show them to scale",
});

const followUpQuestions = {
  turn: choice("How this line relates to the results the artist is already looking at", {
    new: "A search for a different kind of asset, unrelated to what's on screen, e.g. 'brass doorknobs', 'show me barrels'",
    refine: "Narrows, reorders, regroups or cuts down the results on screen, e.g. 'just the 3 smallest', 'only the rusty ones', 'newest first', 'the ones by Kirill', 'one row per era', 'split them into groups by color'",
    act: "Does something with the results on screen, e.g. 'add all to cart', 'make a collection of these', 'line them up'",
  }),
  narrows: noul(
    "The line keeps only some of the assets on screen by what they are or how they look: a narrower kind of object, e.g. 'only the cookware', 'just the pots and pans', 'only the dining chairs', or a look or physical detail such as material, colour, condition, style or parts, e.g. 'only the rusty ones', 'brass ones', 'with arms'. Size order, how many, how to group or lay them out, dates, people, show, approval status, asset type (Character, Environment, Assembly) and visibility don't count.",
  ),
};

const COUNT_WORD = "Is this word a number saying how many assets to show, like '3' in 'just the 3 smallest' or 'five' in 'top five'? A number of rows or groups to lay them out in, like 'one' in 'one row per era' or 'two' in 'split into two groups', is not how many assets to show.";
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function readCount(word: string): number | null {
  const n = Number.parseInt(word, 10);
  if (Number.isFinite(n) && n > 0) return n;
  const i = NUMBER_WORDS.indexOf(word.toLowerCase());
  return i > 0 ? i : null;
}

const MEMBERSHIP = {
  kind: "Is this asset the kind of object the search is for? Ignore material, colour and other details.",
  details: "Does this asset have every detail the search asks for, such as material, colour, condition or parts? Answer yes if the search asks for no details.",
};

export type Candidate = { id: string; name: string; categories: string[]; tags: string[]; description: string };

/**
 * What the file holds goes before the description, which often skips it: a ship cannon's three cannonballs. Only for
 * assets holding more than one kind of thing; "Holds: 1 wooden stool" made the check stricter on "all chairs".
 */
export const describe = (c: Candidate) => {
  const contents = (holds as Record<string, Holds>)[c.id]?.contents ?? [];
  const held = contents.length > 1 && contents.map((t) => `${t.count} ${t.thing}`).join(", ");
  return `${c.name}. ${held ? `Holds: ${held}. ` : ""}Categories: ${c.categories.join(", ")}. Tags: ${c.tags.join(", ")}. ${c.description}`.slice(0, 600);
};

let client: TypeSafeClient | null = null;

export function jevEnabled(): boolean {
  const key = process.env.TYPESAFE_API_KEY?.trim() ?? "";
  return key.length >= 12 && !/\.\.\.|your|placeholder/i.test(key);
}

function answer<T extends string>(r: { choice: T; confidence: number; probabilities: { readonly [k in T]: number } }): Answer<T> {
  return { value: r.choice, confidence: r.confidence, probabilities: { ...r.probabilities } as Partial<Record<T, number>> };
}

function jev(timeout: number) {
  client ??= new TypeSafeClient({ defaultModel: process.env.JEV_MODEL || "jev-latest", retry: { maxRetries: 0 }, timeout });
  return client;
}

const DESCRIBES =
  "Does this word help describe which assets the artist wants (what they are, look like, or contain), rather than how many, how to sort, compare, lay out, group or arrange them (like 'color' in 'grouped by color' or 'era' in 'one row per era'), or filter them by date, person, show, approval status, asset type or visibility, or what to do with them (add to cart, make a collection)? A word that names the order, like 'size' in 'sort by size' or 'newest' in 'newest chairs', doesn't describe them; a word saying how big the asset is, like 'small' or 'tall', does. Filler like 'of', 'all' or 'the' doesn't describe them.";
const MAX_WORDS = 24;

/** "material" in "group by material" names the rows, not which assets to keep; Jev's word read misses this for judged fields. */
export function namesGrouping(word: string, groupBy: FieldKey | "none"): boolean {
  if (groupBy === "none") return false;
  const w = word.toLowerCase().replace(/[^a-z]/g, "").replace(/^colour/, "color");
  const names = [groupBy, ...FIELDS[groupBy].label.toLowerCase().split(" ")];
  return names.includes(w) || names.includes(w.replace(/s$/, ""));
}

/** `previous` is the search already on screen; when set, Jev also reads the line as a possible follow-up. */
export async function classifyWithJev(text: string, previous?: string, signal?: AbortSignal): Promise<Intent> {
  const started = performance.now();
  const words = (stripFacets(text) || text).trim().split(/\s+/).slice(0, MAX_WORDS);
  const wordQs = Object.fromEntries(words.map((word, i) => [`w${i}`, noul({ word, position: i + 1, question: DESCRIBES })]));
  const countQs = previous ? Object.fromEntries(words.map((word, i) => [`n${i}`, noul({ word, position: i + 1, question: COUNT_WORD })])) : {};
  const state: Record<string, string> = previous ? { query: text, previous_search: previous } : { query: text };
  const res = await jev(4000).systemOne({ state, questions: { ...questions, action: ACTION, ...wordQs, ...(previous ? followUpQuestions : {}), ...countQs } }, { signal });
  const a = res.answers;
  const raw = res.answers as unknown as Record<string, { noul: number }>;
  const describes = words.map((w, i) => (namesGrouping(w, a.groupBy.choice) ? 0 : raw[`w${i}`].noul));
  const best = describes.indexOf(Math.max(...describes));
  const namesALook = describes.some((d) => d >= 0.5);
  const kept = words.filter((_, i) => describes[i] >= 0.5 || (i === best && !namesALook));
  const chosen = <T extends string>(key: string) => answer(raw[key] as unknown as { choice: T; confidence: number; probabilities: Record<T, number> });
  const followUp: FollowUp | undefined = previous
    ? {
        turn: chosen<Turn>("turn"),
        narrows: namesALook ? raw.narrows.noul : 0,
        limit: words.map((w, i) => (raw[`n${i}`].noul >= 0.5 ? readCount(w) : null)).find((n) => n != null) ?? null,
      }
    : undefined;
  return {
    action: chosen<Action>("action"),
    followUp,
    view: answer(a.view),
    count: answer(a.count),
    subject: answer(a.subject),
    animalUnsaid: a.animalUnsaid.noul,
    visual: a.visual.noul,
    plan: {
      about: kept.join(" ") || text,
      scope: answer(a.scope),
      sort: answer(a.sort),
      window: answer(a.window),
      sideBySide: a.arrangement.probabilities.side_by_side,
      author: a.person.noul >= 0.5 ? matchAuthor(text) : null,
      facets: readFacets(text),
      browse: a.browse.noul,
      groupBy: answer(a.groupBy),
    },
    source: "jev",
    model: res.model,
    latencyMs: Math.round(performance.now() - started),
  };
}

/** Which of the artist's collections a line like "put these in my wooden chairs collection" names, or null for a new one. */
export async function pickCollection(line: string, names: string[], signal?: AbortSignal): Promise<{ index: number | null; confidence: number }> {
  const options = Object.fromEntries([
    ...names.map((name, i) => [`c${i}`, `Their existing collection called "${name}"`]),
    ["new", "A new collection, or no collection named"],
  ]);
  const res = await jev(4000).systemOne({ state: { line }, questions: { target: choice("Which collection the artist wants these assets put in", options) } }, { signal });
  const { choice: picked, confidence } = res.answers.target as { choice: string; confidence: number };
  return { index: picked === "new" ? null : Number(picked.slice(1)), confidence };
}

/** Probability each candidate belongs in the set the search describes: P(right kind) x P(has the details). */
export async function checkMembership(search: string, candidates: Candidate[], signal?: AbortSignal): Promise<Record<string, number>> {
  const qs = Object.fromEntries(
    candidates.flatMap((c, i) => [
      [`k${i}`, noul({ asset: describe(c), question: MEMBERSHIP.kind })],
      [`d${i}`, noul({ asset: describe(c), question: MEMBERSHIP.details })],
    ]),
  );
  const res = await jev(4000).systemOne({ state: { search }, questions: qs }, { signal });
  const a = res.answers as Record<string, { noul: number }>;
  return Object.fromEntries(candidates.map((c, i) => [c.id, a[`k${i}`].noul * a[`d${i}`].noul]));
}
