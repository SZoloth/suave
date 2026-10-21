import type { Asset } from "./api";
import { FACET_RULES } from "./compose/schema.ts";
import { facetsOf } from "./compose/program.ts";

export type PlannedSection = { name: string; title: string; query: string };
/**
 * The review only trims what a row's own search found: the artist may already be looking at it, and a fresh search under the same title drifts to other things.
 * `ids` null: keep the whole row.
 */
export type Verdict = { kind: "keep"; ids: string[] | null } | { kind: "missing" };
export type SceneFacet = { label: string; values: { label: string; ids: string[] }[] };
export type Review = { verdicts: Record<string, Verdict>; facets: SceneFacet[] };
export type SceneSection = { title: string; query: string; assets: Asset[] };
/** Null assets: that row's search hasn't landed. */
export type SceneRow = { title: string; assets: Asset[] | null };
export type Scene =
  /** Rows show as their searches land, before the review settles them. */
  | { stage: "searching"; rows: SceneRow[] }
  | { stage: "settled"; program: string; missing: string[] };

export const PLAN_PROMPT = `You plan a page of asset library results for an animation artist. The artist asked for a set of different things that belong together. Write OpenUI Lang and nothing else:
root = View([tables, lamps])
tables = Section("Tables", "tavern table")
lamps = Section("Lamps", "hanging oil lamp")

Each Section is its own search of the asset library. Use 2 to 5 sections, the most important first.
Search text is short, what an artist types: an object noun plus at most one trait. No scene words the assets would not be tagged with.
Search text adds no trait the artist did not ask for.
Titles are 1 to 3 plain studio words.`;

export const REVIEW_PROMPT = `An artist's search was split into sections, each its own search of an asset library. You see the assets each search found, numbered across all sections.
Reply one line per section, exactly one of:
name = Keep([1, 4, 5])   listing the numbers of its assets that are what the section's title promises.
name = Missing   when none of its assets are.
Then, optionally, facets over the asset numbers, written as:
f0 = Facet("Label", [Value("Label", [1, 4, 7]), Value("Label", [2, 9])])
${FACET_RULES.join("\n")}
A facet's values cover assets from one section or across sections; a facet never repeats the sections.`;

const PLAN_LINE = /^(\w+)\s*=\s*Section\("([^"]*)",\s*"([^"]*)"\)\s*$/gm;

export function parsePlan(text: string): PlannedSection[] {
  const seen = new Set<string>();
  const out: PlannedSection[] = [];
  for (const m of text.matchAll(PLAN_LINE)) {
    const name = m[1];
    if (seen.has(name) || out.length >= 5) continue;
    seen.add(name);
    out.push({ name, title: m[2], query: m[3] });
  }
  return out;
}

function idAt(numbered: Asset[], n: number): string | undefined {
  return numbered[n - 1]?.id;
}

/** `sections` carry the assets the model saw, numbered in this order across all of them. */
export function parseReview(text: string, sections: (PlannedSection & { assets: Asset[] })[]): Review {
  const numbered = sections.flatMap((s) => s.assets);
  const verdicts: Record<string, Verdict> = {};
  /** With one section the model often drops the `name =`; with more, a bare verdict could be anyone's. */
  const sole = sections.length === 1 ? sections[0].name : null;

  for (const raw of text.split("\n")) {
    const m = raw.trim().match(/^(?:(\w+)\s*=\s*)?(Keep|Missing)\s*(?:\((.*)\))?\s*$/);
    const section = m && sections.find((s) => s.name === (m[1] ?? sole));
    if (!m || !section) continue;
    if (m[2] === "Missing") {
      verdicts[section.name] = { kind: "missing" };
      continue;
    }
    const own = new Set(section.assets.map((a) => a.id));
    const ids = [...(m[3] ?? "").matchAll(/\d+/g)].map((n) => idAt(numbered, Number(n[0]))).filter((id): id is string => !!id && own.has(id));
    verdicts[section.name] = { kind: "keep", ids: ids.length > 0 ? [...new Set(ids)] : null };
  }

  const facets: SceneFacet[] = facetsOf(text)
    .map((f) => ({
      label: f.label,
      values: f.values
        .map((v) => ({
          label: v.label,
          ids: [...new Set(v.assets.map((n) => idAt(numbered, n)).filter((id): id is string => !!id))],
        }))
        .filter((v) => v.ids.length >= 2)
        .slice(0, 4),
    }))
    .filter((f) => f.values.length >= 2)
    .slice(0, 3);

  return { verdicts, facets };
}

/** What the review leaves of each row, in row order, and the titles of the rows it drops. A row whose best match is under `floor` is dropped too. */
export function judgeRows(rows: (PlannedSection & { assets: Asset[] })[], verdicts: Record<string, Verdict>, floor: number) {
  const kept: SceneSection[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const v = verdicts[row.name] ?? { kind: "keep", ids: null };
    switch (v.kind) {
      case "keep": {
        const assets = v.ids ? row.assets.filter((a) => v.ids?.includes(a.id)) : row.assets;
        if ((assets[0]?.score ?? 0) >= floor) kept.push({ title: row.title, query: row.query, assets });
        else missing.push(row.title);
        break;
      }
      case "missing":
        missing.push(row.title);
        break;
      default: {
        const unreachable: never = v;
        throw new Error(`unhandled verdict ${JSON.stringify(unreachable)}`);
      }
    }
  }
  return { kept, missing };
}

export function assembleScene(sections: SceneSection[], facets: SceneFacet[] = []): { members: Asset[]; program: string } {
  const members: Asset[] = [];
  const seen = new Set<string>();
  for (const s of sections) {
    for (const a of s.assets) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      members.push(a);
    }
  }
  const num = new Map(members.map((a, i) => [a.id, i + 1]));

  const partNames: string[] = [];
  const lines: string[] = [];
  const grouped = new Set<string>();
  for (const s of sections) {
    const assets: number[] = [];
    for (const a of s.assets) {
      if (grouped.has(a.id)) continue;
      grouped.add(a.id);
      const n = num.get(a.id);
      if (n != null) assets.push(n);
    }
    if (assets.length === 0) continue;
    const name = `s${partNames.length}`;
    partNames.push(name);
    lines.push(`${name} = Group(${JSON.stringify(s.title)}, [${assets.join(", ")}])`);
  }
  if (partNames.length === 0) return { members: [], program: "" };

  const facetRefs: string[] = [];
  for (const f of facets) {
    const valueNames: string[] = [];
    const valueLines: string[] = [];
    for (const v of f.values) {
      const assets = [...new Set(v.ids.map((id) => num.get(id)).filter((n): n is number => n != null))];
      if (assets.length < 2) continue;
      const vn = `f${facetRefs.length}v${valueNames.length}`;
      valueNames.push(vn);
      valueLines.push(`${vn} = Value(${JSON.stringify(v.label)}, [${assets.join(", ")}])`);
    }
    if (valueNames.length < 2) continue;
    const fn = `f${facetRefs.length}`;
    facetRefs.push(fn);
    lines.push(...valueLines, `${fn} = Facet(${JSON.stringify(f.label)}, [${valueNames.join(", ")}])`);
  }

  const root =
    facetRefs.length > 0
      ? `root = Results([${partNames.join(", ")}], [], [${facetRefs.join(", ")}])`
      : `root = Results([${partNames.join(", ")}], [])`;
  return { members, program: [root, ...lines].join("\n") };
}
