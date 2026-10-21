import assert from "node:assert/strict";
import test from "node:test";
import { followUps, keepParts, settle, usableFacets } from "./compose/program.ts";

const program = `root = Results([wood, metal], ["only the painted ones", "tallest first"])
wood = Group("All wood", [1, 4, 2])
metal = Group("Wood and metal", [3])`;

const withFacets = `root = Results([chairs], ["only the painted ones"], [arms])
chairs = Group("Chairs", [1, 2, 3, 4, 5])
arms = Facet("Arms", [withArms, noArms])
withArms = Value("With arms", [1, 2])
noArms = Value("No arms", [3, 5])`;
const arms = { label: "Arms", values: [{ label: "With arms", assets: [1, 2] }, { label: "No arms", assets: [3, 5] }] };

test("follow-ups ignore a third facets argument", () => {
  assert.deepEqual(followUps(withFacets), ["only the painted ones"]);
});

test("one group and one facet is a composed layout", () => {
  assert.deepEqual(settle(withFacets, false), { status: "composed", program: withFacets, next: ["only the painted ones"], facets: [arms] });
});

test("offered layouts carry their facets", () => {
  assert.deepEqual(settle(withFacets, true), { status: "offered", program: withFacets, titles: ["Chairs"], facets: [arms] });
});

test("inline values over several lines read the same as named ones", () => {
  const p = `root = Results([lamps], [], [mount])
lamps = Group("Lamps", [1, 2, 3, 4, 5])
mount = Facet("Mounting", [
    Value("Hanging", [1, 4]),
    Value("Wall-mounted", [2, 3, 3])
])`;
  assert.deepEqual(usableFacets(p), [{ label: "Mounting", values: [{ label: "Hanging", assets: [1, 4] }, { label: "Wall-mounted", assets: [2, 3] }] }]);
});

test("values with one asset drop, and a facet left with one value drops", () => {
  const p = `root = Results([a, b], [], [legs])
a = Group("All wood", [2, 7])
b = Group("Wood and metal", [1, 3])
legs = Facet("Legs", [Value("Pedestal", [1, 2]), Value("Metal legs", [3]), Value("Curved legs", [7])])`;
  assert.deepEqual(usableFacets(p), []);
});

test("a facet that splits the assets the way the groups do drops", () => {
  const p = `root = Results([metal, wood, other], [], [mat])
metal = Group("Metal drums", [1, 3, 5, 6])
wood = Group("Wooden barrels", [2, 4])
other = Group("Other barrels", [10])
mat = Facet("Materials", [Value("Metal", [1, 3, 5, 6, 10]), Value("Wood", [2, 4])])`;
  assert.deepEqual(usableFacets(p), []);
});

test("a facet whose values are unions of groups drops", () => {
  const p = `root = Results([conifers, broadleaf, shrubs], [], [leaf])
conifers = Group("Coniferous", [1, 2, 5])
broadleaf = Group("Broadleaf", [3, 4])
shrubs = Group("Shrubs", [6, 7, 8, 9])
leaf = Facet("Foliage", [Value("Needles", [1, 2, 5]), Value("Leaves", [3, 4, 6, 7, 8])])`;
  assert.deepEqual(usableFacets(p), []);
});

test("a facet that splits a single group stays, one nearly everything shares drops", () => {
  const crates = (wood: string, plastic: string) => `root = Results([crates], [], [mat])
crates = Group("Crates", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
mat = Facet("Material", [Value("Wood", [${wood}]), Value("Plastic", [${plastic}])])`;
  assert.deepEqual(usableFacets(crates("1, 2, 3", "4, 5")).map((f) => f.label), ["Material"]);
  assert.deepEqual(usableFacets(crates("1, 2, 3, 4, 5, 6, 7, 8, 9", "10, 11")), []);
});

test("a quick layout morphs in with its follow-ups", () => {
  assert.deepEqual(settle(program, false), { status: "composed", program, next: ["only the painted ones", "tallest first"], facets: [] });
});

test("a late layout is offered by its group titles", () => {
  assert.deepEqual(settle(program, true), { status: "offered", program, titles: ["All wood", "Wood and metal"], facets: [] });
});

test("a single group stays a flat grid", () => {
  assert.deepEqual(settle(`root = Results([a])\na = Group("Chairs", [1, 2])`, false), { status: "flat" });
});

test("an empty group beside one real group stays a flat grid", () => {
  const p = `root = Results([chairs, none])\nchairs = Group("Chairs", [1, 2])\nnone = Group("No stools found", [])`;
  assert.deepEqual(settle(p, false), { status: "flat" });
  assert.deepEqual(settle(p, true), { status: "flat" });
});

test("an empty group is left out of an offered layout's titles", () => {
  const p = `root = Results([a, b, none])\na = Group("All wood", [1, 2])\nb = Group("Wood and metal", [3])\nnone = Group("No stools found", [])`;
  assert.deepEqual(settle(p, true), { status: "offered", program: p, titles: ["All wood", "Wood and metal"], facets: [] });
});

test("an error body or a root with no parts stays flat", () => {
  assert.deepEqual(settle("Gemini 503: overloaded", false), { status: "flat" });
  assert.deepEqual(settle("root = Results([a, b])", false), { status: "flat" });
});

test("a pick beside a group counts as a layout", () => {
  const p = `root = Results([best, rest])\nbest = Pick(2, "Exactly a stool")\nrest = Group("Benches", [1, 3])`;
  assert.equal(settle(p, false).status, "composed");
});

test("past five parts, the four biggest stay in order and the rest fall to other matches", () => {
  const part = (title: string, n: number) => ({ props: { title, assets: Array.from({ length: n }, (_, i) => i + 1) } });
  const parts = [part("Ana", 3), part("Ben", 1), part("Cy", 6), part("Di", 2), part("Ed", 1), part("Flo", 4)];
  assert.deepEqual(keepParts(parts).map((p) => p.props.title), ["Ana", "Cy", "Di", "Flo"]);
  assert.deepEqual(keepParts(parts.slice(0, 5)).map((p) => p.props.title), ["Ana", "Ben", "Cy", "Di", "Ed"]);
});
