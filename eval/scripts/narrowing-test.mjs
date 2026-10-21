import { readFileSync } from "node:fs";

const APP = new URL("../..", import.meta.url).pathname;
const BASE = "http://127.0.0.1:5187";
const assets = new Map(JSON.parse(readFileSync(`${APP}/embed/index/assets.json`, "utf8")).map((a) => [a.id, a]));
const { queries } = JSON.parse(readFileSync(`${APP}/eval/membership.json`, "utf8"));
const { threads } = JSON.parse(readFileSync(`${APP}/eval/threads.json`, "utf8"));

const post = (path, body) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const onScreen = (q) => {
  const g = queries[q];
  if (!g) return null;
  return Object.entries(g.labels)
    .filter(([, inSet]) => inSet)
    .map(([id]) => {
      const { name, categories, tags, description } = assets.get(id);
      return { id, name, categories, tags, description };
    });
};

const rows = [];
for (const th of threads) {
  const base = th.lines[0].text;
  const members = onScreen(base);
  for (const line of th.lines.slice(1)) {
    if (line.expected === "act" || !line.read) continue;
    const intent = await post("/api/intent", { query: line.text });
    const about = intent.plan.about;
    const r = members ? await post("/api/members", { search: about, candidates: members }) : { fit: null };
    const fits = r.fit ? Object.values(r.fit).filter((f) => f >= 0.5).length : null;
    const top = r.fit ? Math.max(...Object.values(r.fit)).toFixed(2) : "-";
    rows.push({ base, line: line.text, about, expected: line.expected, jev: `${line.read.turn} ${line.read.confidence.toFixed(2)}`, fits, of: members?.length, top });
  }
}
console.table(rows);
