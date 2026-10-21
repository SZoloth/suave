import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset } from "./api.ts";
import { versionsOf } from "./versions.ts";

const asset = (id: string, extra: Partial<Asset> = {}) =>
  ({ id, name: id, author: "Ana", lastModifiedBy: "Ben", createdAt: "2026-01-01T00:00:00Z", lastModifiedAt: "2026-01-31T00:00:00Z", ...extra }) as Asset;

test("history runs from creation by the author to the last change by the last author, ending on the current look", () => {
  const v = versionsOf(asset("wooden_chair_01"));
  assert.ok(v.length >= 2 && v.length <= 5);
  assert.deepEqual([v[0].n, v[0].by, v[0].at], [1, "Ana", Date.parse("2026-01-01T00:00:00Z")]);
  assert.deepEqual([v.at(-1)?.n, v.at(-1)?.by, v.at(-1)?.at, v.at(-1)?.stage], [v.length, "Ben", Date.parse("2026-01-31T00:00:00Z"), "Look dev"]);
  assert.deepEqual(v, versionsOf(asset("wooden_chair_01")));
});

test("an asset with no dates or authors still gets a history", () => {
  const v = versionsOf({ id: "x", name: "x" } as Asset);
  assert.equal(v.at(-1)?.stage, "Look dev");
  assert.ok(v.every((s) => s.by === "Unknown"));
});
