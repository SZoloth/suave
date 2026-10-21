import { readFileSync } from "node:fs";

const APP = new URL("../..", import.meta.url).pathname;
const assets = new Map(JSON.parse(readFileSync(`${APP}/embed/index/assets.json`, "utf8")).map((a) => [a.id, a]));
const { queries } = JSON.parse(readFileSync(`${APP}/eval/membership.json`, "utf8"));
const reviewed = Object.entries(queries).filter(([, g]) => g.reviewedAt);
const CUTOFFS = [0.3, 0.4, 0.5, 0.6, 0.7];

async function fits(kind, g) {
  const candidates = g.candidates.map((c) => {
    const { id, name, categories, tags, description } = assets.get(c.id);
    return { id, name, categories, tags, description };
  });
  const r = await fetch("http://127.0.0.1:5187/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search: g.about, candidates, fresh: true, kind }),
  }).then((x) => x.json());
  if (!r.fit) throw new Error(`no fit for ${g.about}`);
  return r.fit;
}

for (const kind of process.argv.slice(2)) {
  for (const run of [1, 2]) {
    const all = await Promise.all(reviewed.map(async ([q, g]) => ({ q, g, fit: await fits(kind, g) })));
    const row = CUTOFFS.map((c) => {
      let wrong = 0;
      let missing = 0;
      for (const { g, fit } of all)
        for (const [id, label] of Object.entries(g.labels)) {
          const shown = (fit[id] ?? 0) >= c;
          if (shown && !label) wrong++;
          if (!shown && label) missing++;
        }
      return `${c}: ${wrong}w ${missing}m =${wrong + missing}`;
    });
    console.log(kind, `run${run}`, row.join(" | "));
    if (run === 1) {
      const errs = all.flatMap(({ q, g, fit }) =>
        Object.entries(g.labels)
          .filter(([id, l]) => ((fit[id] ?? 0) >= 0.5) !== l)
          .map(([id, l]) => `${q}: ${assets.get(id).name} ${(fit[id] ?? 0).toFixed(2)} ${l ? "missing" : "wrong"}`),
      );
      console.log("  at 0.5:", errs.join("; "));
    }
  }
}
