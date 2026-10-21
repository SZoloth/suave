import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset } from "./api.ts";
import type { LocalCollection } from "./lib/collections.ts";
import type { SavedSearch } from "./lib/saved.ts";
import { updatesFrom } from "./updates.ts";

const asset = (id: string) => ({ id, name: id }) as Asset;
const search = (query: string, seen: string[]): SavedSearch => ({ query, lines: [], label: query, savedAt: 0, openedAt: 100, seen, count: seen.length });
const collection = (id: string, updatedAt: number, sample: boolean): LocalCollection => ({
  id,
  libraryId: id,
  name: id,
  discoverable: false,
  assets: [],
  createdAt: 0,
  updatedAt,
  ...(sample ? { sample: true as const } : {}),
});

test("a saved search shows up only with matches that weren't there at the last look", () => {
  const saved = [search("chairs", ["a", "b"]), search("lamps", ["c"])];
  const results = new Map([
    ["chairs", { assets: [asset("a"), asset("b"), asset("d")], at: 500 }],
    ["lamps", { assets: [asset("c")], at: 500 }],
  ]);
  const items = updatesFrom(saved, results, [], 0);
  assert.deepEqual(
    items.map((u) => (u.kind === "search" ? [u.key, u.fresh.map((a) => a.id)] : null)),
    [["chairs", ["d"]]],
  );
});

test("Library collections changed since the feed was read show up, newest first; your own don't", () => {
  const items = updatesFrom([], new Map(), [collection("old", 50, true), collection("new", 300, true), collection("later", 200, true), collection("mine", 400, false)], 100);
  assert.deepEqual(
    items.map((u) => (u.kind === "collection" ? u.collection.id : null)),
    ["new", "later"],
  );
});
