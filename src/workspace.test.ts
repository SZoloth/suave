import assert from "node:assert/strict";
import { test } from "node:test";
import type { Step } from "./thread.ts";
import { type Workspace, type WorkspaceAction, emptyWorkspace, focusedGroup, groupsOf, workspaceReducer } from "./workspace.ts";

const step = (label: string, query = "all chairs") => ({ label, query }) as Step;
const run = (...actions: WorkspaceAction[]): Workspace => actions.reduce(workspaceReducer, emptyWorkspace);
const ids = (list: { id: string }[]) => list.map((s) => s.id);

test("a new search joins Today on its own and takes the canvas", () => {
  const ws = run({ type: "start", id: "a", steps: [step("All chairs")] }, { type: "start", id: "b", steps: [step("Lamps", "lamps")] });
  assert.equal(ws.focus, "b");
  assert.deepEqual(groupsOf(ws).map(ids), [["a"], ["b"]]);
});

test("follow-ups edit only the focused search and keep its words", () => {
  const ws = run(
    { type: "start", id: "a", steps: [step("All chairs")] },
    { type: "start", id: "b", steps: [step("Lamps", "lamps")] },
    { type: "focus", id: "a" },
    { type: "push", step: step("Only the wooden ones") },
  );
  assert.deepEqual(
    ws.panes.map((p) => (p.kind === "search" ? [p.id, p.query, p.lines] : null)),
    [
      ["a", "all chairs", ["Only the wooden ones"]],
      ["b", "lamps", []],
    ],
  );
  const backToBase = run({ type: "start", id: "a", steps: [step("All chairs"), step("Only the wooden ones")] }, { type: "truncate", keep: 0 });
  assert.deepEqual(backToBase.panes.map((p) => (p.kind === "search" ? p.lines : null)), [[]]);
});

test("joining puts a pane in another pane's group; detaching gives it its own row back", () => {
  const grouped = run(
    { type: "start", id: "a", steps: [step("Wooden chairs")] },
    { type: "start", id: "b", steps: [step("Wooden tables", "wooden tables")] },
    { type: "start", id: "c", steps: [step("Lanterns", "lanterns")] },
    { type: "join", id: "b", into: "a" },
    { type: "join", id: "c", into: "b" },
  );
  assert.deepEqual(ids(focusedGroup(grouped)), ["a", "b", "c"]);
  assert.deepEqual(groupsOf(grouped).map(ids), [["a", "b", "c"]]);
  assert.equal(grouped.focus, "c");

  const detached = workspaceReducer(grouped, { type: "detach", id: "c" });
  assert.deepEqual(groupsOf(detached).map(ids), [["a", "b"], ["c"]]);
  assert.equal(detached.focus, "a");
});

test("a search started beside joins the focused group as one more column", () => {
  const ws = run(
    { type: "start", id: "a", steps: [step("Wooden chairs")] },
    { type: "start", id: "b", steps: [step("Wooden tables", "wooden tables")], beside: true },
    { type: "start", id: "c", steps: [step("Lanterns", "lanterns")], beside: true },
  );
  assert.deepEqual(groupsOf(ws).map(ids), [["a", "b", "c"]]);
  assert.equal(ws.focus, "c");
});

test("a collection opens once, and can sit beside a search", () => {
  const ws = run(
    { type: "start", id: "a", steps: [step("Wooden chairs")] },
    { type: "open", id: "c1", target: { kind: "collection", collectionId: "garden" }, beside: true },
    { type: "open", id: "c2", target: { kind: "collection", collectionId: "garden" } },
  );
  assert.deepEqual(groupsOf(ws).map(ids), [["a", "c1"]]);
  assert.deepEqual(
    ws.panes.map((p) => p.kind),
    ["search", "collection"],
  );
  assert.equal(ws.focus, "c1");
});

test("the pinned column opens once and is not mistaken for a collection", () => {
  const ws = run(
    { type: "start", id: "a", steps: [step("Wooden chairs")] },
    { type: "open", id: "c1", target: { kind: "collection", collectionId: "garden" }, beside: true },
    { type: "open", id: "p1", target: { kind: "pinned" }, beside: true },
    { type: "open", id: "p2", target: { kind: "pinned" }, beside: true },
  );
  assert.deepEqual(groupsOf(ws).map(ids), [["a", "c1", "p1"]]);
  assert.equal(ws.focus, "p1");
});

test("separating a group gives every pane its own row and keeps the canvas on the focused one", () => {
  const ws = run(
    { type: "start", id: "a", steps: [step("Wooden chairs")] },
    { type: "start", id: "b", steps: [step("Wooden tables", "wooden tables")], beside: true },
    { type: "focus", id: "a" },
    { type: "separate", group: "a" },
  );
  assert.deepEqual(groupsOf(ws).map(ids), [["a"], ["b"]]);
  assert.equal(ws.focus, "a");
});

test("removing the focused pane hands the canvas to its group, then home", () => {
  const ws = run(
    { type: "start", id: "a", steps: [step("Wooden chairs")] },
    { type: "add", id: "b", query: "lanterns", lines: [] },
    { type: "join", id: "b", into: "a" },
    { type: "remove", id: "b" },
  );
  assert.equal(ws.focus, "a");
  assert.equal(workspaceReducer(ws, { type: "remove", id: "a" }).focus, null);
});

test("regrouping a pinned search changes only its last step's view", () => {
  const ws = run(
    { type: "start", id: "a", steps: [step("Lamps", "lamps"), step("One row per era")] },
    { type: "start", id: "b", steps: [step("Chairs", "chairs")] },
    { type: "focus", id: "a" },
    { type: "relens", lens: { groupBy: "material", show: ["author"] } },
  );
  assert.deepEqual(
    ws.panes.map((p) => (p.kind === "search" ? p.steps?.map((s) => s.lens ?? null) : null)),
    [[null, { groupBy: "material", show: ["author"] }], [null]],
  );
});
