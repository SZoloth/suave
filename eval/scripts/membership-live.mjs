// Scores the live fit check against the labeled "all X" searches in eval/membership.json.
// node eval/scripts/membership-live.mjs [--base http://127.0.0.1:5297] [--mode members|merged] [--n 2]
// members: the check on its own, as /api/members asks it.
// merged:  the check riding along with the read of the typed line, as /api/intent asks it with candidates.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { base: { type: "string", default: "http://127.0.0.1:5297" }, mode: { type: "string", default: "members" }, n: { type: "string", default: "1" } },
});
const base = values.base;
const post = (u, b) => fetch(base + u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const labeled = JSON.parse(readFileSync(resolve(import.meta.dirname, "../membership.json"), "utf8")).queries;
const FIT = 0.5;

for (let rep = 0; rep < Number(values.n); rep++) {
  await fetch(`${base}/api/cache`, { method: "DELETE" });
  let kept = 0, inSet = 0, dropped = 0, outSet = 0, errors = 0;
  const flips = [];
  for (const [query, g] of Object.entries(labeled)) {
    if (!g.reviewedAt) continue;
    const r = await post("/retrieval/search", { query: g.about, space: "fused", k: 60 });
    const byId = Object.fromEntries(r.semantic.map((a) => [a.id, a]));
    const candidates = Object.keys(g.labels)
      .map((id) => byId[id])
      .filter(Boolean)
      .map(({ id, name, categories, tags, description }) => ({ id, name, categories, tags, description }));
    if (values.mode === "merged") await post("/api/intent", { query, search: g.about, candidates });
    const { fit } = await post("/api/members", { search: g.about, fresh: values.mode !== "merged", candidates });
    if (!fit) errors++;
    for (const c of candidates) {
      const label = g.labels[c.id];
      const says = (fit?.[c.id] ?? 0) >= FIT;
      if (label) (inSet++, (kept += says));
      else (outSet++, (dropped += !says));
      if (label !== says) flips.push(`${query}: ${c.id} label=${label} fit=${(fit?.[c.id] ?? 0).toFixed(2)}`);
    }
  }
  console.log(`${values.mode} run ${rep + 1}: kept ${kept}/${inSet}  dropped ${dropped}/${outSet}  missing checks ${errors}`);
  if (rep === 0) console.log(flips.map((f) => `  ${f}`).join("\n"));
}
