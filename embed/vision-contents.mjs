/**
 * Asks Gemini what each asset contains, from its thumbnail, Poly Haven description and the object names in its file.
 * Writes embed/vision/contents-gemini.json: { [assetId]: { hero, contents: { thing, count }[], versions: string[] } }.
 * Usage: node embed/vision-contents.mjs   (needs vision/files.json from asset-files.mjs)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const REPO_ENV = new URL("../.env.local", import.meta.url);
const local = existsSync(REPO_ENV) && readFileSync(REPO_ENV, "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
if (local) process.env.GEMINI_API_KEY = local[1].trim().replace(/^["']|["']$/g, "");

const MODEL = "gemini-3.8-flash";
const INDEX = new URL("index/", import.meta.url);
const VISION = new URL("vision/", import.meta.url);
const PROMPT = `You are cataloguing a 3D asset library for animation artists. For this asset, say:
- hero: what an artist would call the whole asset, in 1 to 3 plain words, singular unless it is sold as a set (e.g. "fire hydrant", "chess set", "dandelions").
- contents: the separate things an artist would count, each as a plain singular noun with how many there are. Fold parts into the object they belong to: a cabinet's doors, a clock's hands and a hydrant's caps are part of it, not separate things. Things that stand on their own count separately: a cannon's balls, a chess set's pieces, each tree in a group of trees. Several rocks fused into one scan still count as several rocks. A pair (gloves, boots, crutches, earrings) counts as one thing.
- versions: finishes or states of the same model that the file includes as extra copies, e.g. "rusted", "closed", "deflated", "empty". Do not count those copies in contents.`;

const answer = {
  type: "object",
  properties: {
    hero: { type: "string" },
    contents: { type: "array", items: { type: "object", properties: { thing: { type: "string" }, count: { type: "integer" } }, required: ["thing", "count"] } },
    versions: { type: "array", items: { type: "string" } },
  },
  required: ["hero", "contents", "versions"],
};
const usage = { input: 0, output: 0 };

async function ask(id, file) {
  const names = file.objects.map((o) => o.name.trim());
  const facts = `Asset id: ${id}. Description: ${file.description || "none"}. Objects in the file (${names.length}): ${names.slice(0, 60).join(", ")}${names.length > 60 ? ", …" : ""}.`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: "image/png", data: readFileSync(new URL(`thumbs/${id}.png`, INDEX)).toString("base64") } }, { text: `${facts}\n\n${PROMPT}` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: answer },
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const u = json.usageMetadata ?? {};
      usage.input += u.promptTokenCount ?? 0;
      usage.output += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      return JSON.parse(json.candidates[0].content.parts[0].text);
    }
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`${id} ${res.status} ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
  }
}

const files = JSON.parse(readFileSync(new URL("files.json", VISION), "utf8"));
const ids = Object.keys(files).filter((id) => files[id]?.objects);
const out = {};
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      out[id] = await ask(id, files[id]).catch((e) => (console.error(e.message), null));
      if (Object.keys(out).length % 100 === 0) console.log(`${Object.keys(out).length}/${ids.length}`);
    }
  }),
);
writeFileSync(new URL("contents-gemini.json", VISION), JSON.stringify(Object.fromEntries(ids.map((id) => [id, out[id]])), null, 1));
/** Gemini 3.8 Flash paid tier, introductory through Dec 31 2026. Output includes thinking tokens. */
console.log(`wrote embed/vision/contents-gemini.json, ${Object.values(out).filter(Boolean).length} of ${ids.length}, about $${((usage.input * 0.75 + usage.output * 3.75) / 1e6).toFixed(2)}`);
