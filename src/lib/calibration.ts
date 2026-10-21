import { type Space, api } from "../api";
import { FIT } from "../plan";

export type Candidate = { id: string; name: string; fit: number };

/** One graded set query. `labels` holds explicit answers only; a candidate without one shows the checker's proposal. */
export type GradedQuery = {
  about: string;
  ranAt: string;
  candidates: Candidate[];
  labels: Record<string, boolean>;
  reviewedAt: string | null;
};

export type Calibration = { queries: Record<string, GradedQuery> };

export const SET_QUERIES = [
  "all chairs",
  "all tables",
  "all wooden tools",
  "every barrel",
  "all lamps",
  "all rocks",
  "all trees",
  "all vases",
  "all potted plants",
  "all crates",
  "all sofas",
  "all clocks",
];

export const CUTOFFS = [0.3, 0.4, 0.5, 0.6, 0.7];

export const proposed = (c: Candidate) => c.fit >= FIT;
export const answer = (q: GradedQuery, c: Candidate) => q.labels[c.id] ?? proposed(c);

/** Mark reviewed by writing the visible answer for every candidate, so later re-runs can't shift the labels. */
export function review(q: GradedQuery): GradedQuery {
  return { ...q, reviewedAt: new Date().toISOString(), labels: Object.fromEntries(q.candidates.map((c) => [c.id, answer(q, c)])) };
}

export type SweepRow = { cutoff: number; wrong: number; missing: number };

/** Wrong = shown as a match but labeled out. Missing = labeled in but below the cutoff. Reviewed queries only. */
export function sweep(cal: Calibration): { rows: SweepRow[]; queries: number; labels: number } {
  const graded = Object.values(cal.queries).filter((q) => q.reviewedAt);
  const pairs = graded.flatMap((q) => q.candidates.filter((c) => c.id in q.labels).map((c) => ({ fit: c.fit, label: q.labels[c.id] })));
  return {
    queries: graded.length,
    labels: pairs.length,
    rows: CUTOFFS.map((cutoff) => ({
      cutoff,
      wrong: pairs.filter((p) => p.fit >= cutoff && !p.label).length,
      missing: pairs.filter((p) => p.fit < cutoff && p.label).length,
    })),
  };
}

/** The same path a set search takes: Jev's plan, the 60 nearest, then the membership check. */
export async function runQuery(query: string, space: Space): Promise<Pick<GradedQuery, "about" | "ranAt" | "candidates">> {
  const intent = await api.intent(query);
  const result = await api.search(intent.plan.about, space, undefined, false, {}, 60);
  const about = result.corrected ?? intent.plan.about;
  const fit = (await api.members(about, result.semantic, undefined, true)) ?? {};
  const candidates = result.semantic.map(({ id, name }) => ({ id, name, fit: fit[id] ?? 0 })).sort((a, b) => b.fit - a.fit);
  return { about, ranAt: new Date().toISOString(), candidates };
}
