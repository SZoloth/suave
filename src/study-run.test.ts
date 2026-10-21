import assert from "node:assert/strict";
import { test } from "node:test";
import schedule from "./lib/study-schedule.json" with { type: "json" };
import { type Participant, screens } from "./lib/study-run.ts";

test("every participant walks both blocks, a halfway break, the preference and own searches, in that order", () => {
  for (const p of schedule.participants as Participant[]) {
    const list = screens(p);
    const tasks = list.filter((s) => s.kind === "task");
    assert.deepEqual(
      list.map((s) => s.kind),
      ["welcome", ...Array(6).fill("task"), "switch", ...Array(6).fill("task"), "prefer", "own", "done"],
      p.id,
    );
    assert.deepEqual(tasks.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(new Set(tasks.map((t) => t.id)).size, 12, `${p.id} runs each task once`);
    assert.deepEqual([...new Set(tasks.map((t) => t.arm))].length, 2, `${p.id} sees both layouts`);
  }
});

test("own searches always run in the routed layout", () => {
  const own = screens(schedule.participants[1] as Participant).find((s) => s.kind === "own");
  assert.equal(own && "arm" in own && own.arm, "routed");
});
