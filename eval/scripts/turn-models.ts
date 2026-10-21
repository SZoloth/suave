import { readFileSync } from "node:fs";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { classifyWithJev } from "../../server/jev.ts";

const APP = new URL("../..", import.meta.url).pathname;
for (const line of readFileSync(`${APP}/.env.local`, "utf8").split("\n")) {
  const m = line.match(/^(TYPESAFE_API_KEY|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_AUTH_TOKEN)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

type Line = { text: string; expected: "new" | "refine" | "act" };
const { threads } = JSON.parse(readFileSync(`${APP}/eval/threads.json`, "utf8")) as { threads: { lines: Line[] }[] };
const K = Number(process.env.K ?? 24);

const clean = (q: string) =>
  q
    .replace(/^(please\s+)?((find|show|get|give)( me)?|i need|i want|looking for|search for)\s+/i, "")
    .replace(/^(some\s+)?(stuff|things|props|assets)\s+(for|from)\s+/i, "")
    .replace(/^(a|an|the|some)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim() || q;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const OPTS = {
  new: "A search for a different kind of asset, unrelated to what's on screen, e.g. 'brass doorknobs', 'show me barrels'",
  refine: "Narrows, reorders, regroups or cuts down the results on screen, e.g. 'just the 3 smallest', 'only the rusty ones', 'newest first', 'the ones by Kirill', 'one row per era', 'split them into groups by color'",
  act: "Does something with the results on screen, e.g. 'add all to cart', 'make a collection of these', 'line them up'",
};
const Q = "How this line relates to the results the artist is already looking at";
const plain = choice(Q, OPTS);
const aware = choice(Q, {
  new: `${OPTS.new}. The assets it asks for are not among the results on screen.`,
  refine: `${OPTS.refine}, or asks for a kind of asset that some of the results on screen already are.`,
  act: OPTS.act,
});

type Read = { choice: string; confidence: number };
type Decide = (state: Record<string, string>, q: typeof plain) => Promise<Read>;

const typesafe = new TypeSafeClient({ defaultModel: process.env.JEV_MODEL || "jev-latest", retry: { maxRetries: 1 }, timeout: 8000 });
const jev: Decide = async (state, q) => (await typesafe.systemOne({ state, questions: { turn: q } })).answers.turn as unknown as Read;

const clef =
  (model: "clef" | "clef-flash"): Decide =>
  async (state, q) => {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/cloudflare/${model}`,
      { method: "POST", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_AUTH_TOKEN}` }, body: JSON.stringify({ model, state, questions: { turn: q } }) },
    );
    const body = await res.json();
    if (!res.ok) throw new Error(`${model} ${res.status} ${JSON.stringify(body.errors ?? body)}`);
    const turn = (body.result ?? body).answers.turn;
    const probs: Record<string, number> = turn.probabilities ?? {};
    const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
    return { choice: turn.choice ?? top?.[0], confidence: turn.confidence ?? top?.[1] ?? 0 };
  };

const onScreen = async (steps: string[]) => {
  const res = await fetch("http://127.0.0.1:8765/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: steps.join(" "), k: K }),
  });
  return ((await res.json()).semantic as { name: string }[]).map((a) => a.name).join(", ");
};

type Variant = { label: string; run: (text: string, previous: string, names: string) => Promise<Read> };
const deciders: [string, Decide][] = [["Jev", jev]];
if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AUTH_TOKEN)
  deciders.push(["Clef", clef("clef")], ["Clef-flash", clef("clef-flash")]);
const only = process.env.ONLY?.split(",");
const variants: Variant[] = deciders
  .filter(([name]) => !only || only.includes(name))
  .flatMap(([name, decide]) => [
    { label: `${name} previous only`, run: (text, previous) => decide({ query: text, previous_search: previous }, plain) },
    ...(process.env.NAMES
      ? [{ label: `${name} + on-screen names + aware options`, run: (text: string, previous: string, names: string) => decide({ query: text, previous_search: previous, on_screen: names }, aware) }]
      : []),
  ]);

const score = variants.map(() => ({ right: 0, costly: 0, ms: 0 }));
let total = 0;
for (const th of threads) {
  const abouts = new Map<number, string>();
  for (const [j, l] of th.lines.entries()) if (l.expected === "new") abouts.set(j, (await classifyWithJev(l.text)).plan.about);
  let steps: string[] = [];
  for (const [i, l] of th.lines.entries()) {
    if (i > 0) {
      total++;
      const previous = steps.join(", then ");
      const names = process.env.NAMES ? await onScreen(steps) : "";
      const cells: string[] = [];
      for (const [v, variant] of variants.entries()) {
        const started = performance.now();
        const r = await variant.run(l.text, previous, names);
        score[v].ms += performance.now() - started;
        const ok = r.choice === l.expected;
        if (ok) score[v].right++;
        if (l.expected === "new" && r.choice === "refine") score[v].costly++;
        cells.push(`${ok ? " " : "x"}${r.choice}@${r.confidence.toFixed(2)}`);
      }
      console.log(`${l.expected.padEnd(6)} | ${cells.map((c) => c.padEnd(13)).join(" | ")} | "${l.text}" after "${previous}"`);
    }
    if (l.expected === "new") steps = [cap(clean(abouts.get(i) ?? l.text))];
    else if (l.expected === "refine") steps.push(cap(clean(l.text)));
  }
}
for (const [v, variant] of variants.entries())
  console.log(`${variant.label}: ${score[v].right}/${total}, ${score[v].costly} new read as refine, ${Math.round(score[v].ms / total)} ms per read`);
