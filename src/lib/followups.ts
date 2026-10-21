import { api } from "../api";
import type { Turn } from "../intent";
import { cleanQuery, sentenceCase } from "../surfaces";

export type ThreadLine = { text: string; expected: Turn; read?: { turn: Turn; confidence: number } };
/** A scripted thread. The first line is the library search; every later line is read as a possible follow-up. */
export type ScriptedThread = { lines: ThreadLine[]; reviewedAt: string | null };
export type FollowUpSet = { threads: ScriptedThread[] };

const t = (...lines: [string, Turn][]): ScriptedThread => ({ lines: lines.map(([text, expected]) => ({ text, expected })), reviewedAt: null });

/** Expected turns are proposals until a thread is marked reviewed. */
export const SEED: FollowUpSet = {
  threads: [
    t(["all lamps", "new"], ["brass ones", "refine"], ["line them up", "act"]),
    t(["all lamps", "new"], ["brass doorknobs", "new"]),
    t(["all chairs", "new"], ["just the 3 smallest ones", "refine"], ["add all to cart", "act"]),
    t(["all chairs", "new"], ["only the wooden ones", "refine"], ["make a collection of these", "act"]),
    t(["all chairs", "new"], ["show me barrels", "new"]),
    t(["all chairs", "new"], ["stools", "new"]),
    t(["every barrel", "new"], ["rusty ones", "refine"], ["rusty oil drums", "new"]),
    t(["all rocks", "new"], ["the mossy ones", "refine"], ["add these to my cart", "act"]),
    t(["all rocks", "new"], ["a wooden bucket", "new"]),
    t(["all trees", "new"], ["newest first", "refine"], ["just the top five", "refine"]),
    t(["all trees", "new"], ["pine trees", "refine"]),
    t(["all trees", "new"], ["two of those", "refine"]),
    t(["all tables", "new"], ["chairs to go with them", "new"]),
    t(["all vases", "new"], ["the blue ones", "refine"], ["put them side by side", "act"]),
    t(["all crates", "new"], ["wooden ones only", "refine"], ["the ones by kirill sannikov", "refine"]),
    t(["all sofas", "new"], ["a red armchair", "new"]),
    t(["all clocks", "new"], ["wall clocks", "refine"]),
    t(["all lamps", "new"], ["changed this week", "refine"]),
    t(["all potted plants", "new"], ["lanterns", "new"]),
    t(["wooden chairs", "new"], ["sort by size", "refine"], ["compare them", "act"]),
    t(["every barrel", "new"], ["save these as a collection called cellar", "act"]),
  ],
};

/**
 * The search on screen before line `i`, labeled the way the app labels thread steps. Built from expected turns,
 * so each line is scored on its own and one misread doesn't change the context of the lines after it.
 */
function contextBefore(thread: ScriptedThread, i: number, abouts: Map<number, string>): string {
  let steps: string[] = [];
  thread.lines.slice(0, i).forEach((line, j) => {
    if (line.expected === "new") steps = [sentenceCase(cleanQuery(abouts.get(j) ?? line.text))];
    else if (line.expected === "refine") steps.push(sentenceCase(cleanQuery(line.text)));
  });
  return steps.join(", then ");
}

export async function runThread(thread: ScriptedThread): Promise<ScriptedThread> {
  const abouts = new Map(
    await Promise.all(
      thread.lines.flatMap((line, j) => (line.expected === "new" ? [api.intent(line.text).then((i) => [j, i.plan.about] as const)] : [])),
    ),
  );
  const lines = await Promise.all(
    thread.lines.map(async (line, i) => {
      if (i === 0) return line;
      const t = (await api.intent(line.text, undefined, contextBefore(thread, i, abouts))).followUp?.turn;
      return { ...line, read: t ? { turn: t.value, confidence: t.confidence } : undefined };
    }),
  );
  return { ...thread, lines };
}

export type Score = { lines: number; right: number; newAsRefine: number };

export function score(threads: ScriptedThread[]): Score {
  const read = threads.flatMap((th) => th.lines.slice(1).flatMap((l) => (l.read ? [{ expected: l.expected, got: l.read.turn }] : [])));
  return {
    lines: read.length,
    right: read.filter((l) => l.got === l.expected).length,
    newAsRefine: read.filter((l) => l.expected === "new" && l.got === "refine").length,
  };
}
