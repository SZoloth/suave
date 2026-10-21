import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer, Intent } from "./intent.ts";
import type { Asset } from "./api.ts";
import { ACT_THRESHOLD } from "./intent.ts";
import { effectivePlan, partition, wantsCheck } from "./plan.ts";

const groupAnswer = (value: "era" | "author" | "none", confidence: number): Answer<"era" | "author" | "none"> => ({
  value,
  confidence,
  probabilities: { [value]: confidence, none: value === "none" ? confidence : 0 },
});

const intentWithGroup = (groupBy: Answer<"era" | "author" | "none">): Intent =>
  ({
    source: "jev",
    plan: { groupBy },
  }) as Intent;

test("when the check passes nothing, retrieval's best still shows as might also fit", () => {
  const candidates = ["cannon_01", "baseball_01", "football"].map((id) => ({ id }) as Asset);
  const set = partition(candidates, { cannon_01: 0.09, baseball_01: 0.04, football: 0.04 });
  assert.deepEqual(set.members, []);
  assert.deepEqual(set.nearby.map((a) => a.id), ["cannon_01", "baseball_01", "football"]);
});

test("an asset whose file holds the searched thing is a match, whatever the check says", () => {
  const candidates = ["cannon_01", "baseball_01"].map((id) => ({ id }) as Asset);
  const set = partition(candidates, { cannon_01: 0.25, baseball_01: 0.04 }, "cannon ball");
  assert.deepEqual(set.members.map((a) => a.id), ["cannon_01"]);
});

test("a part named only in the file's object list is left to the check", () => {
  const set = partition([{ id: "electric_stove" } as Asset], { electric_stove: 0.2 }, "a hinge");
  assert.deepEqual(set.members, []);
});

test("a plain search for one kind of thing is checked, so near misses drop below the fits", () => {
  assert.equal(wantsCheck({ source: "jev", visual: 0.1 } as Intent), true);
});

test("without Jev there is nothing to check with", () => {
  assert.equal(wantsCheck(null), false);
});

test("effectivePlan groupBy: override null beats Jev", () => {
  const plan = effectivePlan(intentWithGroup(groupAnswer("era", ACT_THRESHOLD + 0.1)), { groupBy: null });
  assert.equal(plan.groupBy, null);
});

test("effectivePlan groupBy: override key beats Jev", () => {
  const plan = effectivePlan(intentWithGroup(groupAnswer("era", ACT_THRESHOLD + 0.1)), { groupBy: "author" });
  assert.equal(plan.groupBy, "author");
});

test("effectivePlan groupBy: unconfident Jev yields null", () => {
  const plan = effectivePlan(intentWithGroup(groupAnswer("era", ACT_THRESHOLD - 0.1)), {});
  assert.equal(plan.groupBy, null);
});

test("effectivePlan groupBy: confident none yields null", () => {
  const plan = effectivePlan(intentWithGroup(groupAnswer("none", ACT_THRESHOLD + 0.1)), {});
  assert.equal(plan.groupBy, null);
});

test("effectivePlan show defaults empty", () => {
  assert.deepEqual(effectivePlan(null, {}).show, []);
  assert.deepEqual(effectivePlan(null, { show: ["author", "size"] }).show, ["author", "size"]);
});
