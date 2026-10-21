import type { Layout } from "./study";

export type Participant = { id: string; blocks: { arm: Layout; tasks: { id: string; scenario: string }[] }[] };

/** A screen with an `arm` only runs in that layout, so reaching it reloads the page into the arm when they differ. */
export type Screen =
  | { kind: "welcome"; tasks: number }
  | { kind: "task"; arm: Layout; id: string; scenario: string; n: number; of: number }
  | { kind: "switch"; done: number }
  | { kind: "prefer" }
  | { kind: "own"; arm: "routed" }
  | { kind: "done"; tasks: number };

export function screens(p: Participant): Screen[] {
  const of = p.blocks.reduce((sum, b) => sum + b.tasks.length, 0);
  const out: Screen[] = [{ kind: "welcome", tasks: of }];
  let n = 0;
  p.blocks.forEach((b, i) => {
    if (i > 0) out.push({ kind: "switch", done: n });
    for (const t of b.tasks) out.push({ kind: "task", arm: b.arm, id: t.id, scenario: t.scenario, n: ++n, of });
  });
  out.push({ kind: "prefer" }, { kind: "own", arm: "routed" }, { kind: "done", tasks: of });
  return out;
}
