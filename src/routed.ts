import { type Asset, type Filters, MATCH_FLOOR, type SearchResult, type Space, api } from "./api";
import { assembleScene, judgeRows, type Scene, type SceneRow } from "./scene";
import type { Count, Subject, View } from "./intent";
import { applyCount, compareTargets, hintedQuery, scaleTarget, similarTarget } from "./parse";
import { type FilterKey, type SetResult, partition } from "./plan";

export type Routed =
  /** `theme`: `about` names a scene or occasion the assets go with, not a kind each asset must be. */
  | { kind: "single"; result: SearchResult; set: SetResult; about: string; theme?: true; scene?: Scene }
  | { kind: "lineup"; result: SearchResult; set: SetResult; about: string }
  | { kind: "compare"; items: { label: string; asset: Asset | null }[] }
  | { kind: "scale"; items: { label: string; asset: Asset | null }[] }
  | { kind: "similar"; anchor: Asset | null; results: Asset[] };

export type SetRouted = Extract<Routed, { kind: "single" | "lineup" }>;

/** A scene's rows while it's still searching and its review hasn't settled it; null for anything final. */
export const searchingRows = (r: Routed | null): SceneRow[] | null =>
  r?.kind === "single" && r.scene?.stage === "searching" ? r.scene.rows : null;

/**
 * Everything that changes which assets come back. Sorting happens after, on the client.
 * `browse`: list everything that passes `filters`, with no kind to search for; `about` is then only the title.
 */
export type RouteInput = { about: string; subject?: Subject; exact?: boolean; filters: Filters; check: boolean; browse?: boolean };

const CHECKED_POOL = 60;
const WHOLE_LIBRARY = 10_000;

/** `onProgress`: a scene's partial answers, shown while the rest of it is still coming. */
export async function route(
  query: string,
  view: View,
  space: Space,
  input: RouteInput,
  signal: AbortSignal,
  onProgress?: (partial: Routed) => void,
): Promise<Routed> {
  const q = hintedQuery(query, input.subject);
  const search = (text: string, k?: number) => api.search(text, space, signal, input.exact, input.filters, k);
  switch (view) {
    case "compare":
    case "scale": {
      const labels = view === "scale" ? [scaleTarget(query)] : compareTargets(query);
      const items = await Promise.all(labels.map(async (label) => ({ label, asset: (await search(label)).semantic[0] ?? null })));
      return { kind: view, items };
    }
    case "similar": {
      const anchor = (await search(similarTarget(query))).semantic[0] ?? null;
      return { kind: "similar", anchor, results: anchor ? (await api.similar([anchor.id], 24)).results : [] };
    }
    case "scene": {
      const fallback = async (missing: string[] = []) => {
        const result = await search(q);
        return {
          kind: "single" as const,
          result,
          set: partition(result.semantic, null),
          about: result.corrected ?? query,
          theme: true as const,
          ...(missing.length > 0 && { scene: { stage: "settled" as const, program: "", missing } }),
        };
      };
      const sceneOf = (members: Asset[], scene: Scene): Routed => ({
        kind: "single",
        result: { query: q, corrected: null, semantic: members, keyword: [], ms: 0 },
        set: { members, nearby: [], checked: true },
        about: query,
        theme: true,
        scene,
      });
      const { sections: planned } = await api.scenePlan(q, signal);
      if (planned.length < 2) return fallback();
      const rows: SceneRow[] = planned.map((s) => ({ title: s.title, assets: null }));
      const show = () => {
        if (signal.aborted) return;
        const members = [...new Map(rows.flatMap((r) => r.assets ?? []).map((a) => [a.id, a])).values()];
        onProgress?.(sceneOf(members, { stage: "searching", rows: [...rows] }));
      };
      show();
      const found = (text: string) => search(text, 8).then((r) => r.semantic);
      const first = await Promise.all(
        planned.map(async (s, i) => {
          const assets = await found(s.query);
          rows[i] = { title: s.title, assets };
          show();
          return { ...s, assets };
        }),
      );
      const review = await api.sceneReview(q, first, signal);
      const { kept, missing } = judgeRows(first, review.verdicts, MATCH_FLOOR);
      if (kept.length === 0) return fallback(missing);
      const { members, program } = assembleScene(kept, review.facets);
      return sceneOf(members, { stage: "settled", program, missing });
    }
    case "single":
    case "lineup":
    case "none": {
      if (input.browse) {
        const result = await api.search("", space, signal, true, input.filters, WHOLE_LIBRARY);
        return { kind: view === "lineup" ? "lineup" : "single", result, set: { members: result.semantic, nearby: [], checked: true }, about: input.about };
      }
      const run = async (filters: Filters) => {
        const result = await api.search(hintedQuery(input.about, input.subject), space, signal, input.exact, filters, input.check ? CHECKED_POOL : undefined);
        const about = input.subject ? input.about : (result.corrected ?? input.about);
        const fit = input.check && result.semantic.length > 0 ? await api.members(about, result.semantic, signal) : null;
        return { kind: view === "lineup" ? ("lineup" as const) : ("single" as const), result, set: partition(result.semantic, fit, about), about };
      };
      const first = await run(input.filters);
      const emptied = first.set.checked && first.set.members.length === 0;
      return (emptied && (await relax(input.filters, run))) || first;
    }
    default: {
      const unreachable: never = view;
      throw new Error(`unhandled view ${unreachable}`);
    }
  }
}

/** Drop one filter at a time, then all of them, and keep the first run where something fits. */
async function relax<R extends { set: SetResult }>(filters: Filters, run: (f: Filters) => Promise<R>): Promise<R | null> {
  const active = (Object.keys(filters) as FilterKey[]).filter((k) => filters[k] != null);
  if (active.length === 0) return null;
  const attempts = active.length > 1 ? [...active.map((k) => [k]), active] : [active];
  for (const dropped of attempts) {
    const kept = Object.fromEntries(Object.entries(filters).filter(([k]) => !dropped.includes(k as FilterKey))) as Filters;
    const r = await run(kept);
    if (r.set.members.length > 0) return { ...r, set: { ...r.set, relaxed: dropped } };
  }
  return null;
}

export function routedAssets(r: Routed, count?: Count): Asset[] {
  switch (r.kind) {
    case "single":
    case "lineup":
      return applyCount(r.set.members, count);
    case "compare":
    case "scale":
      return r.items.map((i) => i.asset).filter((a): a is Asset => a != null);
    case "similar":
      return r.anchor ? [r.anchor, ...r.results] : r.results;
    default: {
      const unreachable: never = r;
      return unreachable;
    }
  }
}
