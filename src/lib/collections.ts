import { type Asset, api } from "../api";

const KEY = "suave-collections";

/**
 * A collection the artist can add to. The fake Library API stores nothing, so made-here collections live in this browser.
 * `id` is local because the fake API hands every new collection the same `libraryId`.
 * `sample`: one of the artist's existing Library collections, simulated by retrieval.
 */
export type LocalCollection = { id: string; libraryId: string; name: string; discoverable: boolean; assets: Asset[]; createdAt: number; updatedAt: number; sample?: true };

function parse(raw: unknown): LocalCollection | null {
  const c = raw as Partial<LocalCollection> | null;
  return typeof c?.id === "string" && typeof c.libraryId === "string" && typeof c.name === "string" && Array.isArray(c.assets) ? (c as LocalCollection) : null;
}

export function loadCollections(): LocalCollection[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.flatMap((r) => parse(r) ?? []) : [];
  } catch {
    return [];
  }
}

const write = (list: LocalCollection[]) => {
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
};

export function recordCollection(libraryId: string, name: string, discoverable: boolean, assets: Asset[], now = Date.now()): LocalCollection[] {
  return write([{ id: crypto.randomUUID(), libraryId, name, discoverable, assets, createdAt: now, updatedAt: now }, ...loadCollections()]);
}

/** Skips assets already in it, and moves the collection to the top. A sample Library collection gets a browser copy that keeps the additions. */
export function addToCollection(target: LocalCollection, assets: Asset[], now = Date.now()): LocalCollection[] {
  const list = loadCollections();
  const hit = list.find((c) => c.id === target.id) ?? target;
  const have = new Set(hit.assets.map((a) => a.id));
  const next = { ...hit, assets: [...hit.assets, ...assets.filter((a) => !have.has(a.id))], updatedAt: now };
  return write([next, ...list.filter((c) => c.id !== hit.id)]);
}

/** The artist's existing Library collections, simulated. Empty when retrieval has none. */
export async function loadLibraryCollections(): Promise<LocalCollection[]> {
  return (await api.libraryCollections()).map((c) => {
    const at = Date.parse(c.lastModifiedAt);
    return { id: c.id, libraryId: c.id, name: c.name, discoverable: false, assets: c.assets, createdAt: at, updatedAt: at, sample: true };
  });
}

/** Browser copies win over the Library listing they came from; most recently changed first. */
export const mergeCollections = (local: LocalCollection[], library: LocalCollection[]) =>
  [...local, ...library.filter((b) => !local.some((c) => c.id === b.id))].sort((a, b) => b.updatedAt - a.updatedAt);
