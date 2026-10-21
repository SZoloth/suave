/**
 * Decides what an asset gives an artist for a query's noun: one ready-to-use thing, or several to pick from.
 * `pullable` says whether the matching things are separate objects in the file (a kit's pieces, five dandelions) or
 * fused into one mesh (a rock scan), since only separate ones are easy to take one of.
 */

/** What an asset holds, from a vision read of its preview (hero, contents, versions) and its file's object list. */
export type Holds = {
  hero: string;
  contents: { thing: string; count: number }[];
  versions: string[];
  objects: { name: string; vertices: number }[];
};

export type Multiplicity = { answer: "one" | "several"; count: number; pullable: boolean };

export const singular = (word: string) =>
  word.replace(/(lea|loa|hal|kni|shel|wol|thie)ves$/, "$1f").replace(/ies$/, "y").replace(/(s|x|ch|sh)es$/, "$1").replace(/([^s])s$/, "$1");
const words = (text: string) =>
  text.toLowerCase().split(/[^a-z]+/).filter((w) => w && !["a", "an", "the", "some", "one", "of"].includes(w)).map(singular);
const KIT = /^(kit|set)$/;
/** Same words in any order, or the same word split differently ("cannon ball" and "cannonball"). */
const same = (a: string[], b: string[]) => (a.length === b.length && a.every((w) => b.includes(w))) || (a.length > 0 && a.join("") === b.join(""));

/** True when every word of the shorter phrase is in the longer one, so "hydrant" matches "fire hydrant". */
function overlaps(q: string[], n: string[]) {
  const [short, long] = q.length <= n.length ? [q, n] : [n, q];
  return short.length > 0 && short.every((w) => long.includes(w));
}

/** True when the search names the asset's hero or a thing its contents list, exactly: a cannon's cannonballs, not a stove's hinge. */
export function names(query: string, asset: Holds): boolean {
  const q = words(query);
  return [asset.hero, ...asset.contents.map((c) => c.thing)].some((t) => same(q, words(t)));
}

export function predict(query: string, asset: Holds): Multiplicity {
  const { objects } = asset;
  const q = words(query);
  const pullable = objects.length > 1;
  /** Asking for the kit or set itself gets the one kit; asking for a piece of it gets several to pick from. */
  if (q.some((w) => KIT.test(w))) return { answer: "one", count: 1, pullable };
  /** A fused scan (one mesh holding many rocks) can't be picked apart, so it's one thing however many it shows. */
  if (objects.length === 1) return { answer: "one", count: 1, pullable };
  /**
   * Versions in the download (clean and rusted, open and closed) are still a pick, so they count as several. The file
   * must back the reading with two main-sized objects: a case whose lid opens, or a cable drawn two ways, is one thing.
   */
  const largest = Math.max(0, ...objects.map((o) => o.vertices));
  const copies = objects.filter((o) => o.vertices >= largest / 2).length;
  const one: Multiplicity =
    asset.versions.length && copies > 1 ? { answer: "several", count: Math.max(2, asset.versions.length), pullable } : { answer: "one", count: 1, pullable };
  const things = asset.contents.map((c) => ({ ...c, w: words(c.thing) }));
  const hero = words(asset.hero);
  const thing = things.find((t) => same(q, t.w)) ?? (same(q, hero) ? undefined : things.find((t) => overlaps(q, t.w)));
  if (thing && thing.count > 1) return { answer: "several", count: thing.count, pullable };
  if (thing) return one;
  /**
   * The contents list skips parts the file still holds as separate objects ("ball" in a cannon, "rook" in a chess set).
   * Only the name after the file's shared prefix counts, so asking for the asset itself matches no part. Numbered
   * copies, distinct parts, or a plural name ("planks") are a pick. Left and right make a pair, and _a/_b or rusted
   * copies are versions, so one matching part falls through to the rules below.
   */
  const names = objects.map((o) => o.name.toLowerCase().split("_"));
  let shared = 0;
  while (names.length > 1 && names.every((n) => n.length > shared + 1 && n[shared] === names[0][shared])) shared++;
  const parts = new Set(
    names
      .map((n) => n.slice(shared).join("_"))
      .filter((n) => q.length && q.every((w) => words(n).includes(w)))
      .map((n) => n.replace(/(^|_)(left|right|aged|rust|[a-z])(?=_|$)/g, "")),
  );
  if (parts.size > 1 || [...parts].some((n) => n.split("_").some((w) => singular(w) !== w))) return { answer: "several", count: Math.max(2, parts.size), pullable };
  /**
   * Whether the asset fits is the membership check's call, so words that match nothing here ("vent" for an air duct kit)
   * read as the whole asset. A plural hero ("stinkkruid plants") names a pack, so asking for one of them still gets several.
   */
  const total = asset.contents.reduce((n, c) => n + c.count, 0);
  const oneKind = asset.contents.length === 1 && pullable;
  const pack = (oneKind || asset.hero.trim().toLowerCase().split(/\s+/).some((w) => singular(w) !== w)) && total > 1;
  return pack ? { answer: "several", count: total, pullable } : one;
}
