import assert from "node:assert/strict";
import { test } from "node:test";
import { readFacets, stripFacets } from "./facets.ts";

test("typed words set facets and leave the kind of asset", () => {
  assert.deepEqual(readFacets("approved chairs on Night Shift this week"), { show: "nightshift", approvalStatus: "approved" });
  assert.equal(stripFacets("approved chairs on Night Shift this week"), "chairs this week");
  assert.deepEqual(readFacets("chair environment assemblies in review for Stone Garden"), { show: "stonegarden", approvalStatus: "in_review", assetType: "location" });
  assert.equal(stripFacets("chair environment assemblies in review for Stone Garden"), "chair");
});

test("not approved reads as work in progress, not approved", () => {
  assert.deepEqual(readFacets("not approved lamps"), { approvalStatus: "wip" });
  assert.equal(stripFacets("not approved lamps"), "lamps");
});

test("a word from a show name alone stays a search", () => {
  assert.deepEqual(readFacets("moss covered rock"), {});
  assert.deepEqual(readFacets("lantern"), {});
  assert.deepEqual(readFacets("hidden assemblies from moss hollow"), { show: "mosshollow", assetType: "location", visibility: "HIDE" });
});
