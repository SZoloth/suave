import type { Asset } from "./api";
import type { Count, Subject } from "./intent";

/** Jev decides the view; code pulls the values out of the text. */

const FILLER = /^(please\s+)?(find|show|get|give)( me)?\s+|^(i need|i want|looking for|search for)\s+/i;

export function compareTargets(q: string): string[] {
  const body = q
    .replace(FILLER, "")
    .replace(/\b(compare|side by side|how (big|tall|large) (is|are))\b/gi, " ")
    .trim();
  return body
    .split(/\s+(?:vs\.?|versus|compared (?:to|with)|next to|beside|and)\s+/i)
    .map((s) => s.replace(/^(a|an|the)\s+/i, "").replace(/[?.!]+$/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function scaleTarget(q: string): string {
  return q
    .replace(FILLER, "")
    .replace(/\b(how (big|tall|large|small) (is|are)|scale( of)?|size of|dimensions( of)?|next to an? (person|human|man|woman))\b/gi, " ")
    .replace(/^\s*(a|an|the)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

export function similarTarget(q: string): string {
  return q
    .replace(FILLER, "")
    .replace(/\b(more like|similar to|like this|looks like|same style as)\b/gi, " ")
    .replace(/^\s*(a|an|the)\s+/i, "")
    .trim();
}

/** Disambiguation picks become a short hint on the embedding query. */
export function hintedQuery(q: string, subject?: Subject): string {
  if (subject === "creature") return `${q} (the living animal)`;
  if (subject === "depiction") return `${q} (an object or prop, not a living animal)`;
  return q;
}

const isGrouped = (a: Asset) => (a.grouped ?? 0) >= 0.5;

/** Puts the asked-for shape first. Never drops assets: "a fir tree" still finds a model of three fir trees, just lower. */
export function applyCount(results: Asset[], count?: Count): Asset[] {
  if (count === "group") return [...results.filter(isGrouped), ...results.filter((a) => !isGrouped(a))];
  if (count === "many_separate" || count === "one") return [...results.filter((a) => !isGrouped(a)), ...results.filter(isGrouped)];
  return results;
}

/** Height and width in metres; Poly Haven dimensions are [x, y, z] in millimetres. */
export function size(a: Asset): { h: number; w: number } | null {
  const [x, y, z] = a.dimensions_mm;
  if (!x || !z) return null;
  return { h: z / 1000, w: Math.max(x, y ?? 0) / 1000 };
}

export function formatMetres(m: number): string {
  return m >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`;
}
