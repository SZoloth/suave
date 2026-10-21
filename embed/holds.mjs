/**
 * Writes embed/vision/holds.json: what each asset holds, joining the vision read of its preview
 * (vision/contents-gemini.json) with its file's object list (vision/files.json). Cards use it to say
 * "N to pick from" for the search, and the one-or-several eval scores the same rule against it.
 * Usage: node embed/holds.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const contents = read("vision/contents-gemini.json");
const files = read("vision/files.json");

const holds = Object.fromEntries(
  Object.entries(contents).map(([id, c]) => [
    id,
    { ...c, objects: (files[id]?.objects ?? []).map(({ name, vertices }) => ({ name, vertices })) },
  ]),
);
writeFileSync(new URL("vision/holds.json", import.meta.url), JSON.stringify(holds));
console.log(`holds for ${Object.keys(holds).length} assets`);
