/**
 * Asks Jev, per asset, whether the model is one object or a group of several in one asset
 * (a pile of rocks, a set of tools). Writes embed/index/grouped.json: { [assetId]: probability }.
 * Usage: npm run embed:grouped
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";

const INDEX = new URL("index/", import.meta.url);
const REPO_ENV = new URL("../.env.local", import.meta.url);
const BATCH = 80;
const QUESTION =
  "Is this asset several separate objects modelled together as one asset, like a pile of rocks, a stack of books, a set of tools or a cluster of mushrooms? A single object with several parts, like a chair or a lamp, is not.";

if (!process.env.TYPESAFE_API_KEY && existsSync(REPO_ENV)) {
  const line = readFileSync(REPO_ENV, "utf8").match(/^TYPESAFE_API_KEY=(.+)$/m);
  if (line) process.env.TYPESAFE_API_KEY = line[1].trim().replace(/^["']|["']$/g, "");
}
if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not set");

const describe = (a) =>
  `${a.name.replace(/_/g, " ")}. Categories: ${a.categories.join(", ")}. Tags: ${a.tags.join(", ")}. ${a.description}`.slice(0, 600);

const client = new TypeSafeClient({ defaultModel: process.env.JEV_MODEL || "jev-latest", timeout: 20000 });
const assets = JSON.parse(readFileSync(new URL("assets.json", INDEX), "utf8"));
const grouped = {};
for (let start = 0; start < assets.length; start += BATCH) {
  const batch = assets.slice(start, start + BATCH);
  const res = await client.systemOne({
    state: {},
    questions: Object.fromEntries(batch.map((a, i) => [`a${i}`, noul({ asset: describe(a), question: QUESTION })])),
  });
  batch.forEach((a, i) => (grouped[a.id] = Math.round(res.answers[`a${i}`].noul * 1000) / 1000));
}
writeFileSync(new URL("grouped.json", INDEX), JSON.stringify(grouped, null, 1));
const count = Object.values(grouped).filter((p) => p >= 0.5).length;
console.log(`wrote ${assets.length} assets to embed/index/grouped.json, ${count} read as grouped`);
