import assert from "node:assert/strict";
import test from "node:test";
import { equalShares, resize } from "./lib/split.ts";

const rounded = (xs: number[]) => xs.map((x) => Math.round(x * 100) / 100);

test("panes start equal", () => {
  assert.deepEqual(rounded(equalShares(3)), [0.33, 0.33, 0.33]);
});

test("dragging a divider moves only its two neighbours", () => {
  assert.deepEqual(rounded(resize(equalShares(3), 0, 0.1, 0.2)), [0.43, 0.23, 0.33]);
});

test("a pane never shrinks below the minimum", () => {
  assert.deepEqual(resize([0.5, 0.5], 0, 0.9, 0.25), [0.75, 0.25]);
  assert.deepEqual(resize([0.5, 0.5], 0, -0.9, 0.25), [0.25, 0.75]);
});
