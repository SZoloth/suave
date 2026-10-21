import assert from "node:assert/strict";
import test from "node:test";
import type { Asset } from "./api.ts";
import { settle, usableFacets } from "./compose/program.ts";
import { assembleScene, judgeRows, parsePlan, parseReview } from "./scene.ts";

const asset = (id: string, score = 0.9): Asset => ({
  id,
  name: id,
  categories: [],
  tags: [],
  collections: [],
  description: "",
  dimensions_mm: [],
  score,
});

test("parsePlan reads sections, dedupes names, caps at five", () => {
  const text = `root = View([a, b, a, c, d, e, f])
a = Section("Tables", "tavern table")
b = Section("Lamps", "oil lamp")
a = Section("Dup", "x")
c = Section("Crates", "wood crate")
d = Section("Barrels", "wood barrel")
e = Section("Chairs", "stool")
f = Section("Sixth", "ignored")`;
  assert.deepEqual(parsePlan(text), [
    { name: "a", title: "Tables", query: "tavern table" },
    { name: "b", title: "Lamps", query: "oil lamp" },
    { name: "c", title: "Crates", query: "wood crate" },
    { name: "d", title: "Barrels", query: "wood barrel" },
    { name: "e", title: "Chairs", query: "stool" },
  ]);
});

test("parseReview maps verdicts and facet numbers to ids", () => {
  const sections = [
    { name: "tents", title: "Tents", query: "canvas tent", assets: [asset("a1"), asset("a2")] },
    { name: "lamps", title: "Lamps", query: "oil lamp", assets: [asset("b1"), asset("b2")] },
  ];
  const text = `tents = Missing
lamps = Keep([4])
f0 = Facet("Mount", [Value("Hanging", [2, 4]), Value("Table", [1, 3])])`;
  assert.deepEqual(parseReview(text, sections), {
    verdicts: { tents: { kind: "missing" }, lamps: { kind: "keep", ids: ["b2"] } },
    facets: [{ label: "Mount", values: [{ label: "Hanging", ids: ["a2", "b2"] }, { label: "Table", ids: ["a1", "b1"] }] }],
  });
});

test("parseReview keeps only a section's own assets, and the whole row when it lists none of them", () => {
  const sections = [
    { name: "a", title: "A", query: "a", assets: [asset("a1"), asset("a2")] },
    { name: "b", title: "B", query: "b", assets: [asset("b1")] },
  ];
  assert.deepEqual(parseReview("a = Keep([1, 3, 9])\nb = Keep([1])", sections).verdicts, {
    a: { kind: "keep", ids: ["a1"] },
    b: { kind: "keep", ids: null },
  });
});

test("parseReview accepts a bare verdict only when there is one section", () => {
  const one = [{ name: "decor", title: "Decor", query: "party banner", assets: [asset("x")] }];
  assert.deepEqual(parseReview('Missing("garden party decor")', one).verdicts, { decor: { kind: "missing" } });
  const two = [...one, { name: "cake", title: "Cake", query: "cake", assets: [asset("y")] }];
  assert.deepEqual(parseReview("Missing\ncake = Keep", two).verdicts, { cake: { kind: "keep", ids: null } });
});

test("assembleScene dedupes across sections, drops empty groups, and maps facets", () => {
  const { members, program } = assembleScene(
    [
      { title: "Chairs", query: "chair", assets: [asset("1"), asset("2")] },
      { title: "More chairs", query: "stool", assets: [asset("2"), asset("3")] },
      { title: "Empty", query: "nope", assets: [] },
    ],
    [{ label: "Back", values: [{ label: "High", ids: ["1", "3"] }, { label: "Low", ids: ["2", "3"] }] }],
  );
  assert.deepEqual(members.map((a) => a.id), ["1", "2", "3"]);
  assert.match(program, /s0 = Group\("Chairs", \[1, 2\]\)/);
  assert.match(program, /s1 = Group\("More chairs", \[3\]\)/);
  assert.doesNotMatch(program, /Empty/);
  assert.match(program, /root = Results\(\[s0, s1\], \[\], \[f0\]\)/);
  assert.match(program, /f0 = Facet\("Back"/);
});

test("judgeRows trims kept rows, and drops missing and weak rows in row order", () => {
  const rows = [
    { name: "a", title: "Cakes", query: "cake", assets: [asset("bun", 0.75), asset("cake", 0.72)] },
    { name: "b", title: "Balloons", query: "balloon", assets: [asset("ball", 0.69)] },
    { name: "c", title: "Presents", query: "gift", assets: [asset("box", 0.9)] },
    { name: "d", title: "Plates", query: "plate", assets: [asset("plate", 0.8)] },
  ];
  const { kept, missing } = judgeRows(rows, { a: { kind: "keep", ids: ["cake"] }, c: { kind: "missing" } }, 0.7);
  assert.deepEqual(
    kept.map((s) => [s.title, s.assets.map((a) => a.id)]),
    [
      ["Cakes", ["cake"]],
      ["Plates", ["plate"]],
    ],
  );
  assert.deepEqual(missing, ["Balloons", "Presents"]);
});

test("a scene's one found row keeps its title only when told to", () => {
  const { program } = assembleScene([{ title: "Crates", query: "crate", assets: [asset("1"), asset("2")] }]);
  assert.equal(settle(program, false).status, "flat");
  assert.equal(settle(program, false, true).status, "composed");
});

test("assembled scene programs settle as composed and drop mirrored facets", () => {
  const { program } = assembleScene(
    [
      { title: "Metal", query: "metal drum", assets: [asset("1"), asset("3")] },
      { title: "Wood", query: "wood barrel", assets: [asset("2"), asset("4")] },
    ],
    [
      {
        label: "Material",
        values: [
          { label: "Metal", ids: ["1", "3"] },
          { label: "Wood", ids: ["2", "4"] },
        ],
      },
    ],
  );
  const settled = settle(program, false);
  assert.equal(settled.status, "composed");
  if (settled.status === "composed") {
    assert.deepEqual(settled.facets, []);
    assert.match(settled.program, /Group\("Metal"/);
    assert.match(settled.program, /Group\("Wood"/);
  }
  assert.deepEqual(usableFacets(program), []);
});
