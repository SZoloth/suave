/**
 * Scores every reader on the reviewer's query and asset pairs from vision-review.mjs ("you searched for X, what does this give
 * you?"). The contents rule answers per query from what the asset holds. Jev and the vision models give one fixed
 * one-or-several per asset, so they answer every query on an asset the same way.
 * Usage: node embed/vision-compare.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { predict } from "../src/multiplicity.ts";
import { pairs } from "./vision-review.mjs";

const INDEX = new URL("index/", import.meta.url);
const VISION = new URL("vision/", import.meta.url);
const LABELS = new URL("pair-labels.json", VISION);
const read = (name) => JSON.parse(readFileSync(new URL(name, VISION), "utf8"));

const jev = JSON.parse(readFileSync(new URL("grouped.json", INDEX), "utf8"));
const contents = read("contents-gemini.json");
const files = read("files.json");
const holds = read("holds.json");
const fixed = (several) => (several === undefined ? "miss" : several ? "several" : "one");
const readers = {
  "contents rule": (p) => predict(p.query, holds[p.id]).answer,
  "Jev, fixed per asset": (p) => fixed(jev[p.id] >= 0.5),
  ...Object.fromEntries(
    readdirSync(VISION)
      .filter((f) => /^(gemini|modal|jev).*\.json$/.test(f))
      .map((f) => [`${f.replace(/\.json$/, "")}, fixed per asset`, ((m) => (p) => fixed(m[p.id]?.several))(read(f))]),
  ),
};

const labels = existsSync(LABELS) ? read("pair-labels.json") : {};
const ANSWERS = ["one", "several", "miss"];
const truth = (p) => labels[p.pair]?.answer;
for (const split of ["dev", "test", "hard", "blind"]) {
  const inSplit = pairs.filter((p) => p.split === split);
  const scored = inSplit.filter((p) => ANSWERS.includes(truth(p)));
  const unsure = inSplit.filter((p) => truth(p) === "unsure").length;
  const counts = ANSWERS.map((a) => `${scored.filter((p) => truth(p) === a).length} ${a}`).join(", ");
  console.log(`\n${split}: ${scored.length} scored of ${inSplit.length} (${counts}${unsure ? `, ${unsure} unsure` : ""})`);
  if (!scored.length) continue;
  for (const [name, says] of Object.entries(readers)) {
    const right = scored.filter((p) => says(p) === truth(p)).length;
    const recall = ANSWERS.map((a) => {
      const these = scored.filter((p) => truth(p) === a);
      return these.length ? `${a} ${these.filter((p) => says(p) === a).length}/${these.length}` : null;
    }).filter(Boolean).join(", ");
    console.log(`  ${name}: ${right}/${scored.length} right (${recall})`);
    if (split === "dev" && name === "contents rule")
      for (const p of scored.filter((p) => says(p) !== truth(p))) console.log(`    ${p.query} → ${p.id}: said ${says(p)}, labeled ${truth(p)}`);
  }
}
