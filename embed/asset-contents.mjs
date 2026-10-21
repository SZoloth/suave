/**
 * Turns each file's object list (vision/files.json) into what the asset contains, so "one or several" can be decided
 * against the query's noun instead of fixed per asset.
 * Writes embed/vision/contents.json: { [assetId]: { contents: { thing, count }[], versions: string[], fused } }.
 * Usage: node embed/asset-contents.mjs [assetId ...]   (prints the named assets)
 */
import { readFileSync, writeFileSync } from "node:fs";

const VISION = new URL("vision/", import.meta.url);
const VERSION = /^(aged|rust|rusted|dirty|dirt|graffiti|closed|dented|deflated)$/;
/** Letters, numbers, sides, sizes and detail levels tell copies of one thing apart rather than naming a new thing. */
const COPY = /^([a-z]|\d+|lod|left|right|large|medium|mid|small|tall|big|inflated)$/;

function contentsOf(id, objects) {
  const versions = new Set();
  const counts = new Map();
  for (const { name } of objects) {
    const tokens = name.trim().toLowerCase().replace(new RegExp(`^${id.toLowerCase()}_?`), "").split(/[_\s.]+/).filter(Boolean).map((t) => t.replace(/(\D)\d+$/, "$1"));
    const version = tokens.filter((t) => VERSION.test(t));
    version.forEach((t) => versions.add(t));
    if (version.length) continue;
    const thing = tokens.filter((t) => !COPY.test(t)).join(" ") || id.replace(/_\d+$/, "").replace(/_/g, " ").toLowerCase();
    counts.set(thing, (counts.get(thing) ?? 0) + 1);
  }
  return { contents: [...counts].map(([thing, count]) => ({ thing, count })), versions: [...versions], fused: objects.length === 1 };
}

const files = JSON.parse(readFileSync(new URL("files.json", VISION), "utf8"));
const out = Object.fromEntries(Object.entries(files).filter(([, f]) => f?.objects).map(([id, f]) => [id, contentsOf(id, f.objects)]));
writeFileSync(new URL("contents.json", VISION), JSON.stringify(out, null, 1));
for (const id of process.argv.slice(2)) {
  const { contents, versions } = out[id];
  console.log(`${id}: ${contents.map((c) => `${c.thing} ×${c.count}`).join(", ")}${versions.length ? ` | versions: ${versions.join(", ")}` : ""}`);
}
