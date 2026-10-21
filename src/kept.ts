import type { Overrides } from "./components/IntentBar.tsx";
import { FACET_KEYS, type FacetKey } from "./facets.ts";
import type { Intent } from "./intent.ts";
import { type EffectivePlan, effectivePlan } from "./plan.ts";

/** A chip the artist can keep for new searches. `cards` is the card lines, apart from the Show facet. */
export type ChipId = "sort" | "groupBy" | "cards" | "window" | "author" | FacetKey;

/** The chip's value as overrides, or null at its default, where there's nothing to keep. */
function valueOf(id: ChipId, plan: EffectivePlan): Overrides | null {
  switch (id) {
    case "sort":
      return plan.sort === "relevance" ? null : { sort: plan.sort };
    case "groupBy":
      return plan.groupBy ? { groupBy: plan.groupBy } : null;
    case "cards":
      return plan.show.length ? { show: plan.show } : null;
    case "window":
      return plan.window === "any" ? null : { window: plan.window };
    case "author":
      return plan.author ? { author: plan.author } : null;
    default: {
      const v = plan.facets[id];
      return v ? { facets: { [id]: v } } : null;
    }
  }
}

export function keptIds(kept: Overrides): ChipId[] {
  const ids: ChipId[] = [];
  if (kept.sort) ids.push("sort");
  if (kept.groupBy) ids.push("groupBy");
  if (kept.show?.length) ids.push("cards");
  if (kept.window && kept.window !== "any") ids.push("window");
  if (kept.author) ids.push("author");
  for (const k of FACET_KEYS) if (kept.facets?.[k]) ids.push(k);
  return ids;
}

export const merge = (a: Overrides, b: Overrides): Overrides => ({ ...a, ...b, facets: { ...a.facets, ...b.facets } });

function drop(kept: Overrides, id: ChipId): Overrides {
  const { sort, groupBy, show, window, author, facets, ...rest } = kept;
  const next: Overrides = { ...rest, sort, groupBy, show, window, author, facets: { ...facets } };
  if (id === "sort") delete next.sort;
  else if (id === "groupBy") delete next.groupBy;
  else if (id === "cards") delete next.show;
  else if (id === "window") delete next.window;
  else if (id === "author") delete next.author;
  else delete next.facets![id];
  return next;
}

export function toggleKeep(kept: Overrides, id: ChipId, plan: EffectivePlan): Overrides {
  if (keptIds(kept).includes(id)) return drop(kept, id);
  const value = valueOf(id, plan);
  return value ? merge(kept, value) : kept;
}

/** A kept chip the artist changes stays kept at its new value; one they clear stops being kept. */
export function follow(kept: Overrides, plan: EffectivePlan): Overrides {
  return keptIds(kept).reduce((next, id) => {
    const value = valueOf(id, plan);
    return value ? merge(next, value) : drop(next, id);
  }, kept);
}

/** Kept chips are defaults: whatever the typed words set wins, the rest stays kept. */
export function under(kept: Overrides, intent: Intent | null): Overrides {
  const read = effectivePlan(intent, {});
  return keptIds(kept).reduce((next, id) => (valueOf(id, read) ? drop(next, id) : next), kept);
}
