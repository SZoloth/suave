/**
 * Asks Jev the vision question three ways so the eval can tell what the picture adds: from the text description only,
 * from the thumbnail only, and from both. Same question as vision-grouped.mjs.
 * Writes embed/vision/jev-<mode>.json: { [assetId]: { several, p } }.
 * Usage: node embed/vision-jev.mjs [text|image|both]   (macOS: thumbnails are upscaled with sips)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MODE = process.argv[2] ?? "both";
if (!["text", "image", "both"].includes(MODE)) throw new Error(`mode must be text, image or both, not ${MODE}`);
const INDEX = new URL("index/", import.meta.url);
const OUT = new URL(`vision/jev-${MODE}.json`, import.meta.url);
const REPO_ENV = new URL("../.env.local", import.meta.url);
const BATCH = 20;
const QUESTION =
  "Is this asset several separate objects modelled together as one asset, like a pile of rocks, a stack of books, a set of tools or a cluster of mushrooms? A single object with several parts, like a chair or a lamp, is not. Nor is one object shown in several finishes or states, like clean and rusted or open and closed.";

if (!process.env.TYPESAFE_API_KEY && existsSync(REPO_ENV)) {
  const line = readFileSync(REPO_ENV, "utf8").match(/^TYPESAFE_API_KEY=(.+)$/m);
  if (line) process.env.TYPESAFE_API_KEY = line[1].trim().replace(/^["']|["']$/g, "");
}
if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not set");

const describe = (a) =>
  `${a.name.replace(/_/g, " ")}. Categories: ${a.categories.join(", ")}. Tags: ${a.tags.join(", ")}. ${a.description}`.slice(0, 600);

/** Jev takes PNG or JPEG of at least 280 px a side; the index thumbnails are 256 px WebP despite the .png name. */
const SIZED = join(tmpdir(), "suave-jev-thumbs");
mkdirSync(SIZED, { recursive: true });
function thumb(id) {
  const out = join(SIZED, `${id}.png`);
  if (!existsSync(out)) {
    execFileSync("sips", ["-s", "format", "png", "-Z", "400", fileURLToPath(new URL(`thumbs/${id}.png`, INDEX)), "--out", out], { stdio: "ignore" });
    execFileSync("sips", ["--padToHeightWidth", "400", "400", "--padColor", "FFFFFF", out], { stdio: "ignore" });
  }
  return readFileSync(out).toString("base64");
}

async function ask(batch) {
  const assets = {};
  const questions = {};
  batch.forEach((a, i) => {
    const ref = `img-${crypto.randomUUID()}`;
    const parts = [];
    if (MODE !== "image") parts.push(`Asset: ${describe(a)}`);
    if (MODE !== "text") {
      assets[ref] = { type: "image", format: "png", data_base64: thumb(a.id) };
      parts.push(`Thumbnail: ${ref}`);
    }
    questions[`a${i}`] = { type: "noul", instructions: `${parts.join("\n")}\n${QUESTION}` };
  });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        "content-type": "application/json",
        ...(MODE !== "text" && { "TypeSafe-Danger-Zone-Images": "true" }),
      },
      body: JSON.stringify({ model: process.env.JEV_MODEL || "jev-1.14.0", state: {}, questions, ...(MODE !== "text" && { assets }) }),
    });
    if (res.ok) return res.json();
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
}

const all = JSON.parse(readFileSync(new URL("assets.json", INDEX), "utf8"));
const answers = {};
let inputTokens = 0;
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < all.length) {
      const batch = all.slice(next, (next += BATCH));
      const json = await ask(batch);
      inputTokens += json.usage?.input_tokens ?? 0;
      batch.forEach((a, i) => {
        const p = Math.round(json.answers[`a${i}`].noul * 1000) / 1000;
        answers[a.id] = { several: p >= 0.5, p };
      });
    }
  }),
);
writeFileSync(OUT, JSON.stringify(Object.fromEntries(all.map((a) => [a.id, answers[a.id] ?? null])), null, 1));
/** Jev bills input tokens only, $0.042 per million, images included. */
console.log(`wrote embed/vision/jev-${MODE}.json, ${Object.values(answers).filter((x) => x.several).length} of ${all.length} several, ${inputTokens} input tokens, about $${((inputTokens * 0.042) / 1e6).toFixed(4)}`);
