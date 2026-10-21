import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Asset } from "../api.ts";
import { Catalog, type IndexFiles, type SearchBody, type SimilarBody, distance, parseNpy } from "./catalog.ts";

const INDEX = new URL("../../embed/index/", import.meta.url);
const json = (name: string) => JSON.parse(readFileSync(new URL(name, INDEX), "utf8"));
const npy = (name: string) => {
  const b = readFileSync(new URL(name, INDEX));
  return parseNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

const files: IndexFiles = {
  assets: json("assets.json"),
  metadata: json("metadata.json"),
  grouped: json("grouped.json"),
  collections: json("collections.json"),
  english: json("english.json"),
  spaces: { fused: npy("fused.npy"), text: npy("text.npy"), image: npy("image.npy") },
};
const catalog = new Catalog(files);
const parity = json("parity.json") as {
  searches: { body: SearchBody; vector: number[] | null; answer: { query: string; corrected: string | null; semantic: Asset[]; keyword: Asset[] } }[];
  similar: { body: SimilarBody; answer: { results: Asset[] } }[];
};

/** Same scores in order, and the same ids at each score. The last score is skipped: ties at the cutoff fall either way. */
function sameRanking(got: Asset[], want: Asset[], label: string) {
  assert.equal(got.length, want.length, `${label}: count`);
  got.forEach((a, i) => assert.ok(Math.abs(a.score - want[i].score) < 2e-4, `${label}: score ${i} ${a.score} vs ${want[i].score}`));
  const byScore = (list: Asset[]) => {
    const m = new Map<string, string[]>();
    for (const a of list) m.set(a.score.toFixed(3), [...(m.get(a.score.toFixed(3)) ?? []), a.id].sort());
    m.delete(list.at(-1)?.score.toFixed(3) ?? "");
    return m;
  };
  assert.deepEqual(byScore(got), byScore(want), `${label}: ids`);
}

test("search matches the Python server on typos, filters, browse and every space", async () => {
  for (const { body, vector, answer } of parity.searches) {
    const label = JSON.stringify(body);
    const got = await catalog.search(body, async (text) => {
      assert.equal(text, answer.corrected ?? answer.query, `${label}: encoded text`);
      return Float32Array.from(vector!);
    });
    assert.equal(got.corrected, answer.corrected, `${label}: correction`);
    sameRanking(got.semantic, answer.semantic, `${label} semantic`);
    sameRanking(got.keyword, answer.keyword, `${label} keyword`);
  }
});

test("an asset hidden in Library still shows when it fits", async () => {
  const row = files.assets.findIndex((a) => a.id === "rubber_boots");
  assert.equal(files.metadata.rubber_boots.visibility, "HIDE");
  const got = await catalog.search({ query: "rubber boot", space: "fused", k: 5 }, async () => files.spaces.fused.slice(row * 768, row * 768 + 768));
  assert.equal(got.semantic[0].id, "rubber_boots");
});

test("similar and complements match the Python server", () => {
  for (const { body, answer } of parity.similar) sameRanking(catalog.similar(body).results, answer.results, JSON.stringify(body));
});

test("a swapped pair of letters is one edit", () => {
  assert.equal(distance("chiar", "chair", 1), 1);
  assert.equal(distance("barrel", "table", 1), 2);
});
