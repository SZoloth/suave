/** Reading the model's OpenUI Lang program without the renderer: enough to decide whether and how to show it. */

/** Past this, or once the artist has touched the results, a new layout waits behind an offer instead of moving cards under them. */
export const MORPH_BUDGET_MS = 1500;

/** A difference the model saw in the assets, as a filter: each value names the asset numbers that have it. */
export type Facet = { label: string; values: { label: string; assets: number[] }[] };

export type Composition =
  | { status: "flat" }
  | { status: "offered"; program: string; titles: string[]; facets: Facet[] }
  | { status: "composed"; program: string; next: string[]; facets: Facet[] };

const PART = /^\w+ = (Group|Lineup|Pick)\(.*\)\s*$/m;

export function groupTitles(program: string): string[] {
  return [...program.matchAll(/(?:Group|Lineup)\("([^"]+)"(?!,\s*\[\s*\])/g)].map((m) => m[1]);
}

/** The root's optional second argument: `root = Results([a, b], ["only the brass ones", ...])`. */
export function followUps(program: string): string[] {
  const list = program.match(/^root = Results\(\[[^\]]*\],\s*\[([^\]]*)\]/m)?.[1] ?? "";
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const numbers = (list: string) => [...new Set(list.match(/\d+/g)?.map(Number) ?? [])];

/** `name = Expr` statements; an expression may run over several lines. */
function statements(program: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of program.matchAll(/^(\w+) = ([\s\S]*?)(?=^\w+ = |(?![\s\S]))/gm)) out.set(m[1], m[2]);
  return out;
}

const VALUE = /Value\("([^"]+)",\s*\[([^\]]*)\]\)/g;

/** Values may sit inline in the facet or as their own statements, referenced by name. */
export function facetsOf(program: string): Facet[] {
  const all = statements(program);
  return [...all.values()].flatMap((expr) => {
    const m = expr.match(/^Facet\("([^"]+)",\s*\[([\s\S]*)\]\)/);
    if (!m) return [];
    const inline = m[2].replace(VALUE, "");
    const named = [...inline.matchAll(/\b(\w+)\b/g)].map((r) => all.get(r[1]) ?? "").join("\n");
    const values = [...`${m[2]}\n${named}`.matchAll(VALUE)].map((v) => ({ label: v[1], assets: numbers(v[2]) }));
    return [{ label: m[1], values }];
  });
}

const groupSets = (program: string) => [...program.matchAll(/(?:Group|Lineup)\("[^"]+",\s*\[([^\]]*)\]\)/g)].map((m) => new Set(numbers(m[1])));

/** A facet earns its chip by splitting a row; one that only repeats the rows, or that nearly every asset shares, doesn't. */
function splitsAGroup(facet: Facet, groups: Set<number>[]): boolean {
  if (!groups.length) return true;
  return groups.some((g) => {
    const counts = facet.values.map((v) => v.assets.filter((n) => g.has(n)).length);
    const covered = counts.reduce((a, b) => a + b, 0);
    return covered > 0 && Math.max(...counts) < 0.8 * covered;
  });
}

/** The model is asked for these limits but doesn't always keep them; a facet that can't narrow the page is dropped. */
export function usableFacets(program: string): Facet[] {
  const groups = groupSets(program);
  return facetsOf(program)
    .map((f) => ({ ...f, values: f.values.filter((v) => v.assets.length >= 2).slice(0, 4) }))
    .filter((f) => f.values.length >= 2 && splitsAGroup(f, groups))
    .slice(0, 3);
}

/** More rows than this stop being scannable, so the smallest parts fall to "Other matches". The model is asked for this too but doesn't always comply. */
export const MAX_PARTS = 5;

type Part = { props: { assets?: unknown } };
const sizeOf = (p: Part) => (Array.isArray(p.props.assets) ? p.props.assets.length : 1);

export function keepParts<P extends Part>(parts: P[]): P[] {
  if (parts.length <= MAX_PARTS) return parts;
  const kept = new Set([...parts].sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, MAX_PARTS - 1));
  return parts.filter((p) => kept.has(p));
}

function partCount(program: string): number {
  return groupTitles(program).length + (program.match(/= Pick\(/g)?.length ?? 0);
}

/**
 * Where a finished program lands. One part alone stays flat unless facets add a second axis to filter on,
 * or `titled`: its title says something the page needs, as a scene's one found row does beside what wasn't found.
 */
export function settle(program: string, late: boolean, titled = false): Composition {
  const facets = usableFacets(program);
  const parts = partCount(program);
  if (!PART.test(program) || parts < 1 || (parts < 2 && facets.length === 0 && !titled)) return { status: "flat" };
  return late
    ? { status: "offered", program, titles: groupTitles(program), facets }
    : { status: "composed", program, next: followUps(program), facets };
}
