import assert from "node:assert/strict";
import { test } from "node:test";
import { type Holds, predict } from "./multiplicity.ts";

const obj = (name: string, vertices = 500) => ({ name, vertices });

const cannon: Holds = {
  hero: "cannon",
  contents: [{ thing: "cannon", count: 1 }],
  versions: [],
  objects: [obj("cannon_01_frame", 20000), obj("cannon_01_barrel", 3000), obj("cannon_01_ball_01"), obj("cannon_01_ball_02"), obj("cannon_01_ball_03")],
};

test("asking for the asset itself is one thing", () => {
  assert.deepEqual(predict("a cannon", cannon), { answer: "one", count: 1, pullable: true });
});

test("a part the file holds as numbered copies is several to pick from", () => {
  assert.deepEqual(predict("a ball", cannon), { answer: "several", count: 3, pullable: true });
});

test("a two-word search matches a one-word thing", () => {
  const withBalls = { ...cannon, contents: [...cannon.contents, { thing: "cannonball", count: 3 }] };
  assert.deepEqual(predict("cannon ball", withBalls), { answer: "several", count: 3, pullable: true });
});

test("a kit asked for by name is one, a piece of it is several", () => {
  const kit: Holds = { hero: "chess set", contents: [{ thing: "chess piece", count: 32 }, { thing: "chessboard", count: 1 }], versions: [], objects: [obj("board"), obj("piece_rook_01"), obj("piece_rook_02")] };
  assert.equal(predict("a chess set", kit).answer, "one");
  assert.deepEqual(predict("a chess piece", kit), { answer: "several", count: 32, pullable: true });
});

test("a fused scan is one however many it shows", () => {
  const scan: Holds = { hero: "rocks", contents: [{ thing: "rock", count: 12 }], versions: [], objects: [obj("rocks_scan", 90000)] };
  assert.deepEqual(predict("a rock", scan), { answer: "one", count: 1, pullable: false });
});

test("two versions of the model in the file are several", () => {
  const boots: Holds = { hero: "rubber boots", contents: [{ thing: "rubber boot", count: 2 }], versions: ["clean", "dirty"], objects: [obj("rubber_boots", 4000), obj("rubber_boots_dirty", 4000)] };
  assert.deepEqual(predict("a rubber boot", boots), { answer: "several", count: 2, pullable: true });
});
