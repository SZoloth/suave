/**
 * Asks a vision model, per asset thumbnail, the same one-or-several question grouped.mjs asks Jev from text.
 * Writes embed/vision/<model>.json: { [assetId]: { several, objects } }. Not part of the index.
 * Usage: node embed/vision-grouped.mjs gemini-3.8-flash   (GEMINI_API_KEY from .env.local, else the environment)
 *        node embed/vision-grouped.mjs ollama:qwen3-vl:8b (needs `ollama serve`)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const REPO_ENV = new URL("../.env.local", import.meta.url);
const local = existsSync(REPO_ENV) && readFileSync(REPO_ENV, "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
if (local) process.env.GEMINI_API_KEY = local[1].trim().replace(/^["']|["']$/g, "");

const MODEL = process.argv[2] ?? "gemini-3.8-flash";
const INDEX = new URL("index/", import.meta.url);
const OUT = new URL("vision/", import.meta.url);
const QUESTION =
  "Is this asset several separate objects modelled together as one asset, like a pile of rocks, a stack of books, a set of tools or a cluster of mushrooms? A single object with several parts, like a chair or a lamp, is not. Nor is one object shown in several finishes or states, like clean and rusted or open and closed.";

const answer = {
  type: "object",
  properties: {
    id: { type: "string" },
    objects: { type: "integer", description: "How many separate objects the thumbnail shows" },
    several: { type: "boolean" },
  },
  required: ["id", "objects", "several"],
};
const thumb = (a) => readFileSync(new URL(`thumbs/${a.id}.png`, INDEX)).toString("base64");
const label = (a) => `Asset id: ${a.id}. Name: ${a.name.replace(/_/g, " ")}.`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function retrying(send) {
  for (let attempt = 0; ; attempt++) {
    const res = await send();
    if (res.ok) return res.json();
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    await wait(15_000 * (attempt + 1));
  }
}

const usage = { input: 0, output: 0 };

/** One thumbnail per request, as the other providers get. On the free tier (5 a minute) use BATCH=25 PACE_MS=13000. */
const gemini = {
  batch: Number(process.env.BATCH) || 1,
  paceMs: Number(process.env.PACE_MS) || 0,
  workers: process.env.PACE_MS ? 1 : 8,
  async ask(batch) {
    const parts = batch.flatMap((a) => [{ text: label(a) }, { inlineData: { mimeType: "image/png", data: thumb(a) } }]);
    parts.push({ text: `Answer for each asset above, judging each thumbnail on its own. ${QUESTION}` });
    const json = await retrying(() =>
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "array", items: answer } },
        }),
      }),
    );
    const u = json.usageMetadata ?? {};
    usage.input += u.promptTokenCount ?? 0;
    usage.output += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    return JSON.parse(json.candidates[0].content.parts[0].text);
  },
};

const ollama = {
  batch: 1,
  paceMs: 0,
  workers: 1,
  async ask([a]) {
    const json = await retrying(() =>
      fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        body: JSON.stringify({
          model: MODEL.slice("ollama:".length),
          stream: false,
          think: false,
          format: answer,
          options: { temperature: 0 },
          messages: [{ role: "user", content: `${label(a)} ${QUESTION}`, images: [thumb(a)] }],
        }),
      }),
    );
    return [{ ...JSON.parse(json.message.content), id: a.id }];
  },
};

const provider = MODEL.startsWith("ollama:") ? ollama : gemini;
const assets = JSON.parse(readFileSync(new URL("assets.json", INDEX), "utf8"));
const answers = {};
let next = 0;
await Promise.all(
  Array.from({ length: provider.workers }, async () => {
    while (next < assets.length) {
      const batch = assets.slice(next, (next += provider.batch));
      const started = Date.now();
      for (const { id, ...rest } of await provider.ask(batch)) answers[id] = rest;
      const done = Object.keys(answers).length;
      if (done % 50 < provider.batch) console.log(`${done}/${assets.length}`);
      await wait(Math.max(0, provider.paceMs - (Date.now() - started)));
    }
  }),
);
mkdirSync(OUT, { recursive: true });
const file = `${MODEL.replace(/[:/]/g, "-")}.json`;
writeFileSync(new URL(file, OUT), JSON.stringify(Object.fromEntries(assets.map((a) => [a.id, answers[a.id] ?? null])), null, 1));
console.log(`wrote embed/vision/${file}, ${Object.values(answers).filter((x) => x.several).length} of ${Object.keys(answers).length} read as several`);
if (usage.input) {
  /** Gemini 3.8 Flash paid tier, introductory through Dec 31 2026. Output includes thinking tokens. */
  const cost = (usage.input * 0.75 + usage.output * 3.75) / 1e6;
  console.log(`tokens: ${usage.input} in, ${usage.output} out (with thinking), about $${cost.toFixed(2)}`);
}
