import type { Asset } from "./api.ts";
import type { LocalCollection } from "./lib/collections.ts";
import { type SavedSearch, savedKey } from "./lib/saved.ts";

export type Replayed = { assets: Asset[]; at: number };
export type Update =
  | { kind: "search"; key: string; search: SavedSearch; assets: Asset[]; fresh: Asset[]; at: number }
  | { kind: "collection"; collection: LocalCollection; at: number };

export function updatesFrom(saved: SavedSearch[], results: Map<string, Replayed>, collections: LocalCollection[], seenAt: number): Update[] {
  const searches: Update[] = saved.flatMap((search) => {
    const key = savedKey(search.query, search.lines);
    const hit = results.get(key);
    if (!hit) return [];
    const seen = new Set(search.seen);
    const fresh = hit.assets.filter((a) => !seen.has(a.id));
    return fresh.length > 0 ? [{ kind: "search" as const, key, search, assets: hit.assets, fresh, at: hit.at }] : [];
  });
  const changed: Update[] = collections.filter((c) => c.sample && c.updatedAt > seenAt).map((collection) => ({ kind: "collection" as const, collection, at: collection.updatedAt }));
  return [...searches, ...changed].sort((a, b) => b.at - a.at);
}
