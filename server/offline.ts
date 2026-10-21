import type { Answer, Intent } from "../src/intent.ts";
import { readFacets, stripFacets } from "../src/facets.ts";
import { matchAuthor } from "./authors.ts";

/** Keyword rules with the same output shape as Jev, so the UI can run without a key. */

function normalize<T extends string>(scores: Record<T, number>): Answer<T> {
  const entries = Object.entries(scores) as [T, number][];
  const exp = entries.map(([k, v]) => [k, Math.exp(v)] as const);
  const total = exp.reduce((s, [, v]) => s + v, 0);
  const probabilities = Object.fromEntries(exp.map(([k, v]) => [k, v / total])) as Record<T, number>;
  const [value, confidence] = (Object.entries(probabilities) as [T, number][]).sort((a, b) => b[1] - a[1])[0];
  return { value, confidence, probabilities };
}

const has = (re: RegExp, t: string) => re.test(t);

const SCENE = /\b(stuff|things|props|set dressing|dressing|decor|decorations?|for an? |for the |kit|set for|scene|themed?|everything)\b/;
const COMPARE = /\b(vs\.?|versus|compared? (to|with)|next to|beside|side by side)\b/;
const SCALE = /\b(how (big|tall|large|small)|scale|size of|dimensions?|next to a (person|human|man|woman))\b/;
const SIMILAR = /\b(more like|similar to|like this|looks like|same style as)\b/;
const GROUP = /\b(pile|stack|heap|bunch|group|cluster|set) of\b/;
const COLOR = /\b(red|orange|yellow|green|blue|purple|pink|black|white|grey|gray|brown|gold|silver|rusty|rusted|old|broken|worn|wooden|metal|glass|stone|with)\b/;
const DEPICTION = /\b(skeleton|statue|toy|stuffed|figurine|plush|carving|sculpture|model of)\b/;
const CREATURE = /\b(dog|cat|horse|bird|fish|animal|creature|cow|pig|wolf|bear|deer|rabbit|mouse|rat|dragon)\b/;
const NATURE = /\b(tree|plant|rock|stone|flower|grass|bush|shrub|log|branch|moss|leaf|leaves|succulent|fern)\b/;
const STRUCTURE = /\b(building|house|room|bridge|tower|lighthouse|shed|wall|fence|hut|structure)\b/;

/** The noun the query is about: last word before a qualifier, e.g. "basket" in "basket with apples". */
function headNoun(t: string): string {
  const core = t
    .replace(/^(please\s+)?(find|show|get|give)( me)?\s+|^(i need|i want|looking for)\s+/, "")
    .split(/\b(?:with|of|in|for|that|thats|that's|which|on|from)\b/)[0]
    .trim();
  return core.split(/\s+/).pop() ?? "";
}

export function classifyOffline(raw: string): Intent {
  const t = raw.toLowerCase().trim();
  const words = t.split(/\s+/).filter(Boolean);
  const head = headNoun(t);
  const plural = head.length > 3 && head.endsWith("s") && !head.endsWith("ss");

  const view = normalize({
    single: 2.5,
    scene: has(SCENE, t) ? 4 : 0,
    compare: has(COMPARE, t) ? 4.5 : 0,
    scale: has(SCALE, t) ? 4.5 : 0,
    similar: has(SIMILAR, t) ? 4.5 : 0,
    none: words.length === 0 || t.length < 3 ? 5 : 0,
  });
  const count = normalize({
    one: plural ? 0 : 1.5,
    many_separate: plural ? 1 : 0,
    group: has(GROUP, t) ? 3 : 0,
    unclear: plural && !has(GROUP, t) ? 1.2 : 0,
  });
  const creature = has(CREATURE, t);
  const depiction = has(DEPICTION, t);
  const subject = normalize({
    prop: 1,
    depiction: depiction ? 2.5 : creature ? 2 : 0,
    creature: creature ? (depiction ? 1.2 : 2.5) : 0,
    nature: has(NATURE, t) ? 2.5 : 0,
    structure: has(STRUCTURE, t) ? 2.5 : 0,
    unclear: 0.5,
  });

  const smallest = has(/\b(smallest|shortest|small to (big|large))\b/, t);
  const sort = normalize({
    relevance: 1,
    size_desc: has(/\b(by size|biggest|tallest|largest|by height)\b/, t) && !smallest ? 4 : 0,
    size_asc: smallest ? 4 : 0,
    modified_desc: has(/\b(last|recently) (modified|changed|updated|edited)\b|\bby (modified|updated)\b/, t) ? 4 : 0,
    modified_asc: 0,
    last_author: has(/\bby last author\b/, t) ? 4 : 0,
    created_desc: has(/\b(newest|latest|recently added|new)\b/, t) ? 3.5 : 0,
    created_asc: has(/\b(oldest)\b/, t) ? 4 : 0,
    name: has(/\b(alphabetical(ly)?|a to z|by name)\b/, t) ? 4 : 0,
  });
  const window = normalize({
    any: 1,
    today: has(/\btoday\b/, t) ? 4 : 0,
    this_week: has(/\b(this|last|past) week\b|\blast few days\b/, t) ? 4 : 0,
    this_month: has(/\b(this|last|past) month\b/, t) ? 4 : 0,
    this_year: has(/\b(this|last|past) year\b/, t) ? 4 : 0,
  });

  return {
    view,
    count,
    subject,
    visual: has(COLOR, t) ? 0.8 : 0.15,
    plan: {
      about: stripFacets(raw) || raw.trim(),
      scope: normalize({ all: has(/\b(all|every|each)\b/, t) || sort.value !== "relevance" ? 3 : 0, some: 1.5 }),
      sort,
      window,
      sideBySide: has(COMPARE, t) || /\bcompare\b/.test(t) ? 0.8 : 0.1,
      author: has(/\b(by|from|made by)\s+\w/, t) ? matchAuthor(t) : null,
      facets: readFacets(raw),
      browse: 0,
      groupBy: { value: "none", confidence: 0, probabilities: { none: 1 } },
    },
    source: "offline",
    model: "keyword-rules",
    latencyMs: 0,
  };
}
