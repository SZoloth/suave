import assert from "node:assert/strict";
import { test } from "node:test";
import { follow, keptIds, merge, toggleKeep, under } from "./kept.ts";
import { effectivePlan } from "./plan.ts";

const planOf = (o: Parameters<typeof effectivePlan>[1]) => effectivePlan(null, o);

test("keeping a chip carries its current value; keeping it again lets it go", () => {
  const plan = planOf({ groupBy: "era", facets: { approvalStatus: "approved" } });
  const kept = toggleKeep(toggleKeep({}, "groupBy", plan), "approvalStatus", plan);
  assert.deepEqual(keptIds(kept), ["groupBy", "approvalStatus"]);
  assert.deepEqual(planOf(kept).groupBy, "era");
  assert.deepEqual(keptIds(toggleKeep(kept, "groupBy", plan)), ["approvalStatus"]);
});

test("a chip at its default has nothing to keep", () => {
  assert.deepEqual(keptIds(toggleKeep({}, "sort", planOf({}))), []);
});

test("a kept chip the artist changes stays kept at the new value, and clearing it stops keeping it", () => {
  const kept = toggleKeep({}, "groupBy", planOf({ groupBy: "era" }));
  assert.equal(follow(kept, planOf({ groupBy: "author" })).groupBy, "author");
  assert.deepEqual(keptIds(follow(kept, planOf({ groupBy: null }))), []);
});

test("card lines are kept apart from the Show filter", () => {
  const plan = planOf({ show: ["author"], facets: { show: "nightshift" } });
  assert.deepEqual(keptIds(toggleKeep({}, "cards", plan)), ["cards"]);
});

test("words the artist types beat a kept chip; what they don't name stays kept", () => {
  const kept: Parameters<typeof effectivePlan>[1] = { groupBy: "author", facets: { approvalStatus: "approved" } };
  const intent = { source: "jev", plan: { groupBy: { value: "era", confidence: 0.9, probabilities: { era: 0.9 } } } } as unknown as Parameters<typeof effectivePlan>[0];
  const plan = effectivePlan(intent, under(kept, intent));
  assert.equal(plan.groupBy, "era");
  assert.equal(plan.facets.approvalStatus, "approved");
});

test("an edit that leaves a kept chip out doesn't stop keeping it", () => {
  const kept = toggleKeep({}, "groupBy", planOf({ groupBy: "author" }));
  const next = { turn: "new" as const };
  assert.deepEqual(keptIds(follow(kept, planOf(merge(under(kept, null), next)))), ["groupBy"]);
});
