import type { Asset, Filters } from "./api";
import { FACET_KEYS, type FacetKey, type FacetValue, type Facets, facetLabel } from "./facets.ts";
import type { FieldKey } from "./fields.ts";
import type { Overrides } from "./components/IntentBar";
import { holdsNamed } from "./holds.ts";
import { ACT_THRESHOLD, type Answer, type Intent, type Sort, type Window } from "./intent.ts";
import { timeAgo } from "./lib/recent.ts";
import { STUDY } from "./lib/study.ts";
import { formatMetres, size } from "./parse.ts";

/** Membership above this counts as a match. Fewest mistakes against the labels in eval/membership.json. */
export const FIT = 0.5;
const NEARBY_FLOOR = 0.15;
const NEARBY_MAX = 12;
const FALLBACK = 4;

/** `browse`: list everything that passes the filters, newest change first, with no kind to check. */
export type EffectivePlan = {
  set: boolean;
  lineup: boolean;
  sort: Sort;
  window: Window;
  author: string | null;
  facets: Facets;
  groupBy: FieldKey | null;
  show: FieldKey[];
  browse?: true;
};

export type FilterKey = "author" | "modifiedSince" | FacetKey;

/** `relaxed` names the filters dropped because, applied, nothing fit. */
export type SetResult = { members: Asset[]; nearby: Asset[]; checked: boolean; relaxed?: FilterKey[] };

const confident = <T extends string>(a?: Answer<T>) => (a && a.confidence >= ACT_THRESHOLD ? a.value : undefined);

export function effectivePlan(intent: Intent | null, o: Overrides, setSort: Sort = "relevance"): EffectivePlan {
  const p = intent?.plan;
  const lineup = (p?.sideBySide ?? 0) >= 0.5;
  const asked = o.sort ?? confident(p?.sort);
  const filters = {
    window: o.window ?? confident(p?.window) ?? "any",
    author: o.author !== undefined ? o.author : (p?.author ?? null),
    facets: Object.fromEntries(Object.entries({ ...p?.facets, ...o.facets }).filter(([, v]) => v != null)) as Facets,
  };
  const browse = (p?.browse ?? 0) >= 0.5 && isFiltered(filters);
  const set = browse || confident(p?.scope) === "all";
  const fallback = !set ? "relevance" : browse ? "modified_desc" : lineup ? "size_desc" : setSort;
  const jevGroup = STUDY.layout === "plain" ? null : confident(p?.groupBy);
  const groupBy = o.groupBy !== undefined ? o.groupBy : jevGroup && jevGroup !== "none" ? jevGroup : null;
  const show = o.show ?? [];
  return { set, lineup, sort: asked && (asked !== "relevance" || o.sort) ? asked : fallback, ...filters, groupBy, show, ...(browse && { browse }) };
}

export const isFiltered = (plan: Pick<EffectivePlan, "window" | "author" | "facets">) => plan.window !== "any" || plan.author != null || Object.keys(plan.facets).length > 0;

const TYPE_PLURAL: Record<FacetValue<"assetType">, string> = { geometry: "environment assets", location: "environment assemblies" };

/** "Approved assets on Night Shift, modified this week": what a browse lists, in words. */
export function browseTitle(plan: EffectivePlan): string {
  const { approvalStatus, assetType, show, visibility } = plan.facets;
  const head = [
    visibility === "HIDE" && "hidden",
    approvalStatus && facetLabel("approvalStatus", approvalStatus).toLowerCase(),
    assetType ? TYPE_PLURAL[assetType] : "assets",
    show && `on ${facetLabel("show", show)}`,
    plan.author && `by ${plan.author}`,
  ].filter(Boolean);
  const text = head.join(" ") + (plan.window !== "any" ? `, ${WINDOW[plan.window].label.toLowerCase()}` : "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Overrides that remove the named filters, or every filter when no keys are given. */
export function withoutFilters(o: Overrides, keys: FilterKey[] = ["author", "modifiedSince", ...FACET_KEYS]): Overrides {
  const facets = { ...o.facets };
  for (const k of FACET_KEYS) if (keys.includes(k)) facets[k] = null;
  return { ...o, facets, ...(keys.includes("author") && { author: null }), ...(keys.includes("modifiedSince") && { window: "any" }) };
}

/** "on Night Shift", "approved", "by Kirill": how a filter reads in a sentence. */
export function filterPhrase(key: FilterKey, plan: EffectivePlan): string {
  if (key === "author") return `by ${plan.author}`;
  if (key === "modifiedSince") return WINDOW[plan.window].label.toLowerCase();
  const value = plan.facets[key];
  if (!value) return "";
  const label = facetLabel(key, value as FacetValue<typeof key>);
  return key === "show" ? `on ${label}` : label.toLowerCase();
}

/** The same narrowing as `plan`, as retrieval filters. */
export const filtersOf = (plan: EffectivePlan, now = Date.now()): Filters => ({ author: plan.author, modifiedSince: modifiedSince(plan.window, now), ...plan.facets });

/** Membership is worth a Jev call when the set itself matters, not just the nearest few. */
/** Every Jev search is checked: about 0.15 to 0.35 s, and what doesn't fit drops to "might also fit" instead of padding the results. */
export function wantsCheck(intent: Intent | null): boolean {
  return intent?.source === "jev";
}

export const WINDOW: Record<Window, { label: string; days: number | null }> = {
  any: { label: "Any time", days: null },
  today: { label: "Modified today", days: 1 },
  this_week: { label: "Modified this week", days: 7 },
  this_month: { label: "Modified this month", days: 30 },
  this_year: { label: "Modified this year", days: 365 },
};

export function modifiedSince(window: Window, now = Date.now()): string | undefined {
  const days = WINDOW[window].days;
  return days == null ? undefined : new Date(now - days * 86_400_000).toISOString();
}

export function when(iso: string | undefined): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Date.now() - at < 30 * 86_400_000 ? timeAgo(at) : new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const height = (a: Asset) => size(a)?.h ?? 0;
const heightCaption = (a: Asset) => (size(a) ? `${formatMetres(height(a))} tall` : null);
const time = (iso?: string) => (iso ? Date.parse(iso) : 0);

type SortSpec = {
  label: string;
  value: (a: Asset) => number | string;
  dir: 1 | -1;
  caption?: (a: Asset) => string | null;
  /** Sorts on a field the stand-in library only has sample values for. */
  sample?: boolean;
};

export const SORT: Record<Sort, SortSpec> = {
  relevance: { label: "Best match", value: () => 0, dir: 1 },
  size_desc: { label: "Tallest first", value: height, dir: -1, caption: heightCaption },
  size_asc: { label: "Smallest first", value: height, dir: 1, caption: heightCaption },
  modified_desc: { label: "Last Modified", value: (a) => time(a.lastModifiedAt), dir: -1, caption: (a) => `Modified ${when(a.lastModifiedAt)}`, sample: true },
  modified_asc: { label: "Last Modified, oldest first", value: (a) => time(a.lastModifiedAt), dir: 1, caption: (a) => `Modified ${when(a.lastModifiedAt)}`, sample: true },
  last_author: { label: "Last Author", value: (a) => a.lastModifiedBy ?? "", dir: 1, caption: (a) => a.lastModifiedBy ?? null, sample: true },
  created_desc: { label: "Newest", value: (a) => time(a.createdAt), dir: -1, caption: (a) => `Created ${when(a.createdAt)}` },
  created_asc: { label: "Oldest", value: (a) => time(a.createdAt), dir: 1, caption: (a) => `Created ${when(a.createdAt)}` },
  name: { label: "Name", value: (a) => a.name, dir: 1 },
};

export function sortAssets(assets: Asset[], sort: Sort): Asset[] {
  const { value, dir } = SORT[sort];
  if (sort === "relevance") return assets;
  return [...assets].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * dir;
  });
}

/** Split retrieval candidates into checked members and a short "might also fit" tail, best fit first. */
export function partition(candidates: Asset[], checked: Record<string, number> | null, about = ""): SetResult {
  if (!checked) return { members: candidates, nearby: [], checked: false };
  /** The check reads descriptions, which skip what a file holds; a cannon holding cannonballs fits "cannon ball". */
  const fit = (a: Asset) => (holdsNamed(about, a.id) ? Math.max(FIT, checked[a.id] ?? 0) : (checked[a.id] ?? 0));
  const byFit = [...candidates].sort((a, b) => fit(b) - fit(a));
  const members = byFit.filter((a) => fit(a) >= FIT);
  const nearby = byFit.filter((a) => fit(a) < FIT && fit(a) >= NEARBY_FLOOR).slice(0, NEARBY_MAX);
  /** The check can be wrong about everything; an empty page hides the asset the artist asked for, so retrieval's best stays. */
  return { members, nearby: members.length || nearby.length ? nearby : candidates.slice(0, FALLBACK), checked: true };
}
