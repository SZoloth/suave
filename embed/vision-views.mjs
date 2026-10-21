/**
 * For every thumbnail a vision model counted more than one item in, asks Gemini whether it shows several distinct
 * objects or one object shown more than once (other angles, finishes, open and closed).
 * Writes embed/vision/views/<model>.json: { [assetId]: { kind, why } }.
 * Usage: node embed/vision-views.mjs [model]   (GEMINI_API_KEY from .env.local, else the environment)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const REPO_ENV = new URL("../.env.local", import.meta.url);
const local = existsSync(REPO_ENV) && readFileSync(REPO_ENV, "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
if (local) process.env.GEMINI_API_KEY = local[1].trim().replace(/^["']|["']$/g, "");

const MODEL = process.argv[2] ?? "gemini-3.8-flash";
const INDEX = new URL("index/", import.meta.url);
const VISION = new URL("vision/", import.meta.url);
const OUT = new URL("views/", VISION);
const QUESTION = `This is a product thumbnail for a 3D asset. Which is it?
- "one": a single object shown once.
- "distinct": several different objects, like a pile of rocks, a pair of gloves, a cannon with cannonballs, or three different trees.
- "same_object": one object shown more than once, from other angles, in other finishes or colors, or open and closed.
Pick the one that best describes the thumbnail, and say why in a few words.`;
const schema = {
  type: "object",
  properties: { kind: { type: "string", enum: ["one", "distinct", "same_object"] }, why: { type: "string" } },
  required: ["kind", "why"],
};

const counts = readdirSync(VISION)
  .filter((f) => f.endsWith(".json") && f !== "labels.json")
  .map((f) => JSON.parse(readFileSync(new URL(f, VISION), "utf8")));
const assets = JSON.parse(readFileSync(new URL("assets.json", INDEX), "utf8")).filter((a) => counts.some((c) => (c[a.id]?.objects ?? 1) > 1));

async function ask(a) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: "image/png", data: readFileSync(new URL(`thumbs/${a.id}.png`, INDEX)).toString("base64") } }, { text: `Asset name: ${a.name.replace(/_/g, " ")}. ${QUESTION}` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema },
      }),
    });
    if (res.ok) return JSON.parse((await res.json()).candidates[0].content.parts[0].text);
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`${a.id} ${res.status} ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
}

const answers = {};
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < assets.length) {
      const a = assets[next++];
      answers[a.id] = await ask(a);
    }
  }),
);
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL(`${MODEL}.json`, OUT), JSON.stringify(Object.fromEntries(assets.map((a) => [a.id, answers[a.id]])), null, 1));
const tally = Object.values(answers).reduce((t, { kind }) => ({ ...t, [kind]: (t[kind] ?? 0) + 1 }), {});
console.log(`${assets.length} thumbnails with more than one item counted:`, tally);
