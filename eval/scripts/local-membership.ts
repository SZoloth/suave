import { readFileSync } from "node:fs";
import { describe, type Candidate } from "../../server/jev.ts";

const APP = new URL("../..", import.meta.url).pathname;
const MODEL = process.env.LOCAL_MODEL ?? "qwen3-vl:8b";
const BASE = process.env.LOCAL_MODEL_URL ?? "http://127.0.0.1:11434";
const PARALLEL = Number(process.env.PARALLEL ?? 4);
const FIT = 0.5;
const KIND = "Is this asset the kind of object the search is for? Ignore material, colour and other details.";
const DETAILS = "Does this asset have every detail the search asks for, such as material, colour, condition or parts? Answer yes if the search asks for no details.";

type Group = { about: string; reviewedAt?: string; candidates: { id: string }[]; labels: Record<string, boolean> };
const assets = new Map<string, Candidate>(JSON.parse(readFileSync(`${APP}/embed/index/assets.json`, "utf8")).map((a: Candidate) => [a.id, a]));
const { queries } = JSON.parse(readFileSync(`${APP}/eval/membership.json`, "utf8")) as { queries: Record<string, Group> };
const reviewed = Object.values(queries).filter((g) => g.reviewedAt);

async function yes(search: string, asset: string, question: string): Promise<{ p: number; ms: number }> {
  const started = performance.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      logprobs: true,
      top_logprobs: 10,
      options: { temperature: 0, num_predict: 1 },
      messages: [
        { role: "system", content: "Answer with one word, yes or no." },
        { role: "user", content: `Search: ${search}\nAsset: ${asset}\nQuestion: ${question}` },
      ],
    }),
  }).then((r) => r.json());
  const top: { token: string; logprob: number }[] = res.logprobs?.[0]?.top_logprobs ?? [];
  const mass = (w: string) => top.filter((t) => t.token.trim().toLowerCase() === w).reduce((s, t) => s + Math.exp(t.logprob), 0);
  const y = mass("yes");
  const n = mass("no");
  return { p: y + n > 0 ? y / (y + n) : 0, ms: performance.now() - started };
}

async function pool<T, R>(items: T[], run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]);
    }
  }));
  return out;
}

let tp = 0, fn = 0, tn = 0, fp = 0;
const searchMs: number[] = [];
const callMs: number[] = [];
const misses: string[] = [];
for (const g of reviewed) {
  const started = performance.now();
  const scored = await pool(g.candidates, async ({ id }) => {
    const text = describe(assets.get(id)!);
    const [k, d] = await Promise.all([yes(g.about, text, KIND), yes(g.about, text, DETAILS)]);
    callMs.push(k.ms, d.ms);
    return { id, fit: k.p * d.p };
  });
  searchMs.push(performance.now() - started);
  for (const { id, fit } of scored) {
    const label = g.labels[id];
    if (label === undefined) continue;
    const shown = fit >= FIT;
    if (label && shown) tp++;
    else if (label) { fn++; misses.push(`missed  ${g.about} :: ${assets.get(id)!.name} (${fit.toFixed(2)})`); }
    else if (shown) { fp++; misses.push(`wrong   ${g.about} :: ${assets.get(id)!.name} (${fit.toFixed(2)})`); }
    else tn++;
  }
  console.log(`${g.about.padEnd(24)} ${g.candidates.length} candidates ${Math.round(searchMs.at(-1)!)} ms`);
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`\n${MODEL} at ${FIT}: TPR ${tp}/${tp + fn}, TNR ${tn}/${tn + fp}`);
console.log(`median call ${Math.round(median(callMs))} ms, median search ${Math.round(median(searchMs))} ms, parallel ${PARALLEL}`);
console.log(misses.slice(0, 40).join("\n"));
