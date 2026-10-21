import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, namesGrouping } from "./jev.ts";

test("the field a line groups by isn't a detail to narrow on", () => {
  assert.ok(namesGrouping("material", "material"));
  assert.ok(namesGrouping("colours", "color"));
  assert.ok(namesGrouping("era,", "era"));
  assert.ok(namesGrouping("status", "status"));
  assert.ok(!namesGrouping("wooden", "material"));
  assert.ok(!namesGrouping("material", "none"));
});

test("the membership check reads what the file holds, not only the description", () => {
  const cannon = { id: "cannon_01", name: "cannon 01", categories: ["props"], tags: ["cannon"], description: "A colonial ship cannon." };
  assert.match(describe(cannon), /Holds: 1 cannon, 3 cannonball\b/);
});
