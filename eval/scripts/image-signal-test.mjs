import { readFileSync } from "node:fs";

const APP = new URL("../..", import.meta.url).pathname;
const { queries } = JSON.parse(readFileSync(`${APP}/eval/membership.json`, "utf8"));
const FIT = 0.5;

const imageScores = async (about) => {
  const r = await fetch("http://127.0.0.1:8765/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: about, space: "image", k: 600, exact: true }),
  }).then((x) => x.json());
  return new Map(r.semantic.map((a) => [a.id, a.score]));
};

const all = [];
for (const [q, g] of Object.entries(queries)) {
  const img = await imageScores(g.about);
  const fit = new Map(g.candidates.map((c) => [c.id, c.fit]));
  const name = new Map(g.candidates.map((c) => [c.id, c.name]));
  for (const [id, label] of Object.entries(g.labels)) all.push({ q, id, name: name.get(id), label, fit: fit.get(id), img: img.get(id) });
}

const errors = (pred) => all.reduce((n, r) => n + (pred(r) !== r.label ? 1 : 0), 0);
console.log("baseline fit>=0.5:", errors((r) => r.fit >= FIT));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log("image score  in:", mean(all.filter((r) => r.label).map((r) => r.img)).toFixed(3), " out:", mean(all.filter((r) => !r.label).map((r) => r.img)).toFixed(3));

console.log("\nmistakes at 0.5 with image score and its rank inside the query's in-labeled items:");
for (const r of all.filter((r) => (r.fit >= FIT) !== r.label)) {
  const ins = all.filter((x) => x.q === r.q && x.label).map((x) => x.img).sort((a, b) => a - b);
  const below = ins.filter((s) => s < r.img).length;
  console.log(`${r.label ? "MISSING" : "WRONG  "} ${r.q.padEnd(18)} ${r.name.padEnd(28)} fit ${r.fit.toFixed(2)} img ${r.img.toFixed(3)} (above ${below}/${ins.length} true members)`);
}

console.log("\nper-query z-scored image signal, blended: fit + w * z(img)");
const z = new Map();
for (const q of Object.keys(queries)) {
  const rows = all.filter((r) => r.q === q);
  const m = mean(rows.map((r) => r.img));
  const sd = Math.sqrt(mean(rows.map((r) => (r.img - m) ** 2))) || 1;
  for (const r of rows) z.set(`${q}|${r.id}`, (r.img - m) / sd);
}
for (const w of [0, 0.025, 0.05, 0.075, 0.1, 0.15]) {
  console.log(`w ${w}:`, [0.4, 0.5, 0.6].map((c) => `${c}=${errors((r) => r.fit + w * z.get(`${r.q}|${r.id}`) >= c)}`).join(" "));
}
