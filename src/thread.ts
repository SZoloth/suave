import { api } from "./api";
import type { Intent, Sort, Turn } from "./intent";
import { ACT_THRESHOLD } from "./intent";
import { type EffectivePlan, effectivePlan, modifiedSince, partition, sortAssets } from "./plan";
import type { FacetKey } from "./facets";
import type { FieldKey } from "./fields";
import { type Routed, type SetRouted, routedAssets } from "./routed";

/** One result in a follow-up thread. The first step is a library search; later steps work on the one before. */
export type Step = {
  label: string;
  /** What follow-ups work on. A compare or look-alikes step holds its assets here as a plain set. */
  routed: SetRouted;
  /** The view shown for a first step that wasn't a set. */
  from?: Exclude<Routed, SetRouted>;
  /** The thread started from a scene, compare or look-alikes, so `about` is a theme, not a kind each asset must be. */
  themed?: boolean;
  sort: Sort;
  /** The library search the thread started from. */
  query: string;
  /** How the step is laid out and what its cards say. Later steps inherit it; typed words or the chips change it. */
  lens?: Lens;
};

export type Lens = { groupBy: FieldKey | null; show: FieldKey[] };
export const lensOf = (p: Pick<EffectivePlan, "groupBy" | "show">): Lens => ({ groupBy: p.groupBy, show: p.show });

/** A turn the artist didn't pick and Jev wasn't sure of. */
export type ReadTurn = { turn: Turn; sure: boolean };

export function stepFrom(routed: Routed, plan: EffectivePlan, label: string, query: string): Step {
  if (routed.kind === "single" || routed.kind === "lineup") {
    const themed = routed.kind === "single" && routed.theme;
    return { label, query, routed: { ...routed, result: { ...routed.result, corrected: null } }, sort: plan.sort, lens: lensOf(plan), ...(themed && { themed }) };
  }
  const members = routedAssets(routed);
  const result = { query, corrected: null, semantic: members, keyword: [], ms: 0 };
  return { label, query, sort: plan.sort, lens: lensOf(plan), from: routed, themed: true, routed: { kind: "single", result, set: { members, nearby: [], checked: true }, about: label } };
}

/** What Jev reads as the search on screen: the base, then each follow-up in order. */
export const threadContext = (thread: Step[]) => thread.map((s) => s.label).join(", then ");
/** The thread as typed: the first label drops words like "grouped by color" that the composed view still needs. */
export const askedContext = (thread: Step[]) => thread.map((s, i) => (i === 0 ? s.query : s.label)).join(", then ");

export function readTurn(intent: Intent | null, picked?: Turn): ReadTurn {
  if (picked) return { turn: picked, sure: true };
  const t = intent?.followUp?.turn;
  return t ? { turn: t.value, sure: t.confidence >= ACT_THRESHOLD } : { turn: "new", sure: false };
}

/** Narrow, reorder or cut down the step on screen. Never searches the library. */
export async function refine(step: Step, intent: Intent, label: string, signal: AbortSignal): Promise<Step> {
  const f = intent.followUp;
  const asked = effectivePlan(intent, {});
  let members = step.routed.set.members;
  if (f && f.narrows >= 0.5 && members.length > 0) {
    const search = step.themed ? intent.plan.about : `${step.routed.about}, ${intent.plan.about}`;
    members = partition(members, await api.members(search, members, signal), search).members;
  }
  if (asked.author) members = members.filter((a) => a.author?.toLowerCase().includes(asked.author!.toLowerCase()));
  const since = modifiedSince(asked.window);
  if (since) members = members.filter((a) => (a.lastModifiedAt ?? "") >= since);
  for (const [key, value] of Object.entries(asked.facets)) members = members.filter((a) => a[key as FacetKey] === value);
  const sort = asked.sort !== "relevance" ? asked.sort : step.sort;
  const sorted = sortAssets(members, sort).slice(0, f?.limit ?? undefined);
  const kind = intent.action?.value === "line_up" ? "lineup" : step.routed.kind;
  const lens = { groupBy: asked.groupBy ?? step.lens?.groupBy ?? null, show: step.lens?.show ?? [] };
  return { label, sort, lens, query: step.query, themed: step.themed, routed: { ...step.routed, kind, set: { members: sorted, nearby: [], checked: true } } };
}
