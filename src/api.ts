import type { Facets } from "./facets";
import type { Intent } from "./intent";
import { call } from "./retrieval/client";
import type { SearchBody, SimilarBody } from "./retrieval/catalog";
import type { PlannedSection, Review } from "./scene";
import { STUDY } from "./lib/study";

export type Asset = {
  id: string;
  name: string;
  categories: string[];
  collections: string[];
  tags: string[];
  description: string;
  dimensions_mm: number[];
  author?: string | null;
  createdAt?: string;
  lastModifiedAt?: string;
  lastModifiedBy?: string;
  /** Probability the asset is several objects modelled as one (a pile of rocks), from `npm run embed:grouped`. */
  grouped?: number;
  show?: string;
  assetType?: string;
  visibility?: string;
  approvalStatus?: string;
  /** Fields holding sample values because the stand-in library has no real ones. */
  synthetic?: string[];
  score: number;
};

export type Filters = { author?: string | null; modifiedSince?: string } & Facets;

export type Space = "fused" | "text" | "image";

export type SearchResult = { query: string; corrected: string | null; semantic: Asset[]; keyword: Asset[]; ms: number };

export type RealQuery = {
  date: string;
  query: string;
  resultCount: number | null;
  clickRanks: number[];
  importClicked: boolean;
  importSuccessful: boolean;
  intent: Intent;
};

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}

/** Browsers drop keepalive requests with bodies over 64 KB. */
const KEEPALIVE_LIMIT = 64_000;

/** Top cosine score below this reads as "no close match" on the sample library (set from a handful of queries, not calibrated). */
export const MATCH_FLOOR = 0.7;

export const thumb = (id: string) => `/retrieval/thumbs/${id}.png`;

/** Retrieval runs in a browser worker on the static index (public demo) or on embed/server.py. */
export const browserRetrieval = import.meta.env.VITE_BROWSER_RETRIEVAL === "1";
export type SampleCollection = { id: string; name: string; assets: Asset[]; lastModifiedAt: string };

const retrieval = browserRetrieval
  ? {
      search: (body: SearchBody, signal?: AbortSignal) => call<SearchResult>({ op: "search", body }, signal),
      similar: (body: SimilarBody) => call<{ results: Asset[] }>({ op: "similar", body }),
      collections: () => call<SampleCollection[]>({ op: "collections" }).catch(() => []),
      health: () => call<{ assets: number }>({ op: "health" }).catch(() => null),
    }
  : {
      search: (body: SearchBody, signal?: AbortSignal) => post<SearchResult>("/retrieval/search", body, signal),
      similar: (body: SimilarBody) => post<{ results: Asset[] }>("/retrieval/similar", body),
      collections: () =>
        fetch("/retrieval/collections")
          .then((r) => (r.ok ? (r.json() as Promise<SampleCollection[]>) : []))
          .catch(() => []),
      health: () =>
        fetch("/retrieval/health")
          .then((r) => (r.ok ? (r.json() as Promise<{ assets: number }>) : null))
          .catch(() => null),
    };

export const api = {
  search: (query: string, space: Space, signal?: AbortSignal, exact = false, filters: Filters = {}, k = 24) =>
    retrieval.search({ query, space, k, exact, ...filters }, signal),
  createCollection: (name: string, assets: Asset[], discoverable: boolean) =>
    post<{ id: string; name: string; items: number }>("/api/collections", { name, discoverable, assets: assets.map(({ id, name }) => ({ id, name })) }),
  addToCollection: (id: string, assets: Asset[]) =>
    post<{ items: number }>(`/api/collections/${encodeURIComponent(id)}/items`, { assets: assets.map(({ id, name }) => ({ id, name })) }),
  pickCollection: (line: string, names: string[], signal?: AbortSignal) =>
    post<{ index: number | null; confidence: number }>("/api/pick-collection", { line, names }, signal),
  members: (search: string, candidates: Asset[], signal?: AbortSignal, fresh = false) =>
    post<{ fit: Record<string, number> | null }>(
      "/api/members",
      { search, fresh, candidates: candidates.map(({ id, name, categories, tags, description }) => ({ id, name, categories, tags, description })) },
      signal,
    ).then((r) => r.fit),
  similar: (ids: string[], k = 12) => retrieval.similar({ ids, k }),
  complements: (ids: string[], k = 6) => retrieval.similar({ ids, space: "fused", k, complement: true }),
  libraryCollections: () => retrieval.collections(),
  intent: (query: string, signal?: AbortSignal, previous?: string) => post<Intent>("/api/intent", { query, previous, router: STUDY.router }, signal),
  scenePlan: (query: string, signal?: AbortSignal) =>
    post<{ sections: PlannedSection[] }>("/api/scene", { step: "plan", query }, signal).catch(() => ({ sections: [] })),
  sceneReview: (query: string, sections: (PlannedSection & { assets: Asset[] })[], signal?: AbortSignal) =>
    post<Review>("/api/scene", { step: "review", query, sections }, signal).catch((): Review => ({ verdicts: {}, facets: [] })),
  title: (lines: string[], signal?: AbortSignal) => post<{ title: string | null }>("/api/title", { lines }, signal).then((r) => r.title),
  loadEval: <T>(name: "membership" | "threads") => fetch(`/api/eval/${name}`).then((r) => r.json() as Promise<T | null>),
  saveEval: (name: "membership" | "threads", data: unknown) => {
    const body = JSON.stringify(data);
    return fetch(`/api/eval/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < KEEPALIVE_LIMIT });
  },
  realQueries: () => fetch("/api/real-queries").then((r) => r.json() as Promise<{ jev: boolean; queries: RealQuery[] }>),
  status: async () => {
    const [health, intent] = await Promise.all([
      retrieval.health(),
      fetch("/api/status").then((r) => r.json() as Promise<{ jev: boolean }>),
    ]);
    return { assets: health?.assets ?? null, jev: intent.jev };
  },
};
