import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset } from "./api.ts";
import { CARD_KEYS, FIELDS, groupAssets } from "./fields.ts";

const base = (over: Partial<Asset> = {}): Asset => ({
  id: "a",
  name: "Asset",
  categories: [],
  collections: [],
  tags: [],
  description: "",
  dimensions_mm: [400, 400, 500],
  score: 0,
  ...over,
});

test("groupAssets keeps input order inside each group and orders groups by size", () => {
  const assets = [
    base({ id: "1", author: "Ana" }),
    base({ id: "2", author: "Ana" }),
    base({ id: "3", author: "Bob" }),
    base({ id: "4", author: "Bob" }),
    base({ id: "5", author: "Bob" }),
    base({ id: "6", author: "Bob" }),
  ];
  const groups = groupAssets(assets, "author");
  assert.deepEqual(
    groups.map((g) => [g.title, g.assets.map((a) => a.id)]),
    [
      ["Bob", ["3", "4", "5", "6"]],
      ["Ana", ["1", "2"]],
    ],
  );
});

test("groupAssets puts missing values in No author last", () => {
  const assets = [base({ id: "1" }), base({ id: "2", author: "Ana" }), base({ id: "3" })];
  const groups = groupAssets(assets, "author");
  assert.deepEqual(
    groups.map((g) => [g.title, g.assets.length]),
    [
      ["Ana", 1],
      ["No author", 2],
    ],
  );
});

test("groupAssets caps at five with Other", () => {
  const assets = ["a", "b", "c", "d", "e", "f"].flatMap((author, i) =>
    Array.from({ length: 6 - i }, (_, j) => base({ id: `${author}${j}`, author })),
  );
  const groups = groupAssets(assets, "author");
  assert.equal(groups.length, 5);
  assert.equal(groups[0].title, "a");
  assert.equal(groups[3].title, "d");
  assert.equal(groups[4].title, "Other");
  assert.equal(groups[4].assets.length, 3);
});

test("data field values on a literal asset", () => {
  const a = base({
    author: "Doe, Jane",
    show: "nightshift",
    approvalStatus: "approved",
    assetType: "geometry",
    lastModifiedAt: "2026-10-02T12:00:00.000Z",
    createdAt: "2025-03-15T08:00:00.000Z",
    collections: ["Wooden chairs", "Tavern"],
    dimensions_mm: [200, 200, 250],
  });
  assert.equal(FIELDS.author.kind === "data" && FIELDS.author.value(a), "Doe");
  assert.equal(FIELDS.show.kind === "data" && FIELDS.show.value(a), "Night Shift");
  assert.equal(FIELDS.status.kind === "data" && FIELDS.status.value(a), "Approved");
  assert.equal(FIELDS.type.kind === "data" && FIELDS.type.value(a), "Environment");
  assert.equal(FIELDS.modified.kind === "data" && FIELDS.modified.value(a), "Oct 2026");
  assert.equal(FIELDS.created.kind === "data" && FIELDS.created.value(a), "Mar 2025");
  assert.equal(FIELDS.collection.kind === "data" && FIELDS.collection.value(a), "Wooden chairs");
  assert.equal(FIELDS.size.kind === "data" && FIELDS.size.value(a), "Under 30 cm");
});

test("CARD_KEYS lists every data field", () => {
  assert.deepEqual(CARD_KEYS, ["author", "show", "status", "type", "modified", "created", "collection", "size"]);
});
