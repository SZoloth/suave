/**
 * Review page for query and asset pairs: "you searched for X, what does this asset give you?"
 * Pairs come from the assets readers disagreed on, asking for the whole asset and for each thing it holds several of.
 * The card shows the file's own evidence, not a model's reading, so the label stays independent of the predictions.
 * Each click saves to embed/vision/pair-labels.json: { [pairId]: { answer: "one" | "several" | "miss", note } }.
 * Usage: node embed/vision-review.mjs, then open http://127.0.0.1:5310
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { predict, singular } from "../src/multiplicity.ts";

const PORT = Number(process.env.PORT) || 5310;
const INDEX = new URL("index/", import.meta.url);
const VISION = new URL("vision/", import.meta.url);
const LABELS = new URL("pair-labels.json", VISION);
const read = (name) => JSON.parse(readFileSync(new URL(name, VISION), "utf8"));

const jev = JSON.parse(readFileSync(new URL("grouped.json", INDEX), "utf8"));
const files = read("files.json");
const contents = read("contents-gemini.json");
const holds = read("holds.json");
const oldLabels = existsSync(new URL("labels.json", VISION)) ? read("labels.json") : {};
const readers = readdirSync(VISION)
  .filter((f) => /^(gemini|modal).*\.json$/.test(f) && !f.endsWith("-v1.json"))
  .map((f) => read(f));
const disputed = Object.keys(jev).filter(
  (id) => contents[id] && (oldLabels[id] || readers.some((m) => m[id] && m[id].several !== jev[id] >= 0.5)),
);

const article = (phrase) => (/^[aeiou]/i.test(phrase) ? "an " : "a ") + phrase;
function inFile(id) {
  const objects = files[id]?.objects ?? [];
  if (objects.length === 1) return "1 mesh";
  const names = objects.map((o) => o.name.trim().replace(new RegExp(`^${id}_?`, "i"), "") || "main");
  const shapes = new Set(objects.map((o) => o.vertices)).size;
  const kind = shapes === objects.length ? "all different shapes" : shapes === 1 ? "all the same shape" : `${shapes} different shapes`;
  return `${objects.length} objects, ${kind}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}`;
}
const labels = () => (existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, "utf8")) : {});

/**
 * The pair list is frozen in pairs.json so a model rerun can't move it: entries are only ever appended.
 * "dev" pairs come from disputed assets and tune the readers. "test" pairs are a seeded random sample of the rest,
 * phrased from the asset's own name rather than any model's reading, and their misses are never listed.
 */
const PAIRS = new URL("pairs.json", VISION);
const TEST_SIZE = 40;
const BLIND_SIZE = 24;
const nameQuery = (id) => article(singular(id.replace(/_/g, " ").replace(/\s*\d+\w*$/g, "").trim().toLowerCase()));
function frozen() {
  const list = existsSync(PAIRS) ? JSON.parse(readFileSync(PAIRS, "utf8")) : [];
  const seen = new Set(list.map((p) => `${p.id}::${p.query}`));
  const add = (id, query, split) => seen.has(`${id}::${query}`) || (seen.add(`${id}::${query}`), list.push({ id, query, split }));
  for (const key of Object.keys(labels())) add(key.split("::")[0], key.split("::")[1], "dev");
  for (const id of disputed) {
    const { hero, contents: things } = contents[id];
    const several = things.filter((t) => t.count > 1).sort((a, b) => b.count - a.count).slice(0, 2);
    for (const query of [article(singular(hero)), ...several.map((t) => article(singular(t.thing)))]) add(id, query, "dev");
  }
  if (!list.some((p) => p.split === "test")) {
    const inDev = new Set(list.map((p) => p.id));
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rest = Object.keys(jev).filter((id) => !inDev.has(id) && files[id]).sort().map((id) => [rand(), id]).sort((a, b) => a[0] - b[0]);
    for (const [, id] of rest.slice(0, TEST_SIZE)) add(id, nameQuery(id), "test");
  }
  /** "blind" asks for a part named only in the file, picked by seed so no one chooses the cases the rule was tuned on. */
  if (!list.some((p) => p.split === "blind")) {
    const used = new Set(list.filter((p) => p.split !== "dev").map((p) => p.id));
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const partWords = (id) => {
      const hero = new Set(contents[id].hero.toLowerCase().split(/\W+/).map(singular));
      const own = new Set(id.toLowerCase().split("_"));
      const ws = (files[id]?.objects ?? []).flatMap((o) => o.name.toLowerCase().split(/[^a-z]+/));
      return [...new Set(ws.map(singular))].filter((w) => w.length > 2 && !own.has(w) && !hero.has(w) && !/^(lod|low|high|mesh|geo|main|aged|rust|left|right|small|large|big|flattened|mode|body|hourhand)$/.test(w)).sort();
    };
    const pool = Object.keys(jev).filter((id) => !used.has(id) && contents[id] && partWords(id).length).sort().map((id) => [rand(), id]).sort((a, b) => a[0] - b[0]);
    for (const [, id] of pool.slice(0, BLIND_SIZE)) {
      const ws = partWords(id);
      add(id, article(ws[Math.floor(rand() * ws.length)]), "blind");
    }
  }
  writeFileSync(PAIRS, JSON.stringify(list, null, 1));
  return list;
}
/** Pairs where the reviewer's label and the contents rule disagree, with what the rule says, for adjudicating side by side. */
function disputesNow() {
  const all = labels();
  const out = {};
  for (const p of pairs) {
    const label = all[p.pair]?.answer;
    if (label !== "one" && label !== "several") continue;
    const r = predict(p.query, holds[p.id]);
    if (r.answer !== label) out[p.pair] = `You said ${label === "one" ? "One" : "Several"}. The rule says ${r.answer === "one" ? "One" : `Several (${r.count} to pick from)`}.`;
  }
  return out;
}
export const pairs = frozen().map(({ id, query, split }) => ({
  pair: `${id}::${query}`,
  id,
  query,
  split,
  name: id.replace(/_/g, " "),
  file: inFile(id),
  description: files[id]?.description ?? "",
}));

const page = `<!doctype html><meta charset="utf-8"><title>What does it give you?</title>
<style>
body{font:13px/1.4 system-ui,sans-serif;margin:0;background:#f6f5f2;color:#222}
header{position:sticky;top:0;background:#f6f5f2ee;padding:16px 24px;backdrop-filter:blur(6px);z-index:1}
h1{font-size:18px;margin:0 0 4px}header p{margin:0;color:#666}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;padding:0 24px 24px}
figure{margin:0;background:#fff;border-radius:10px;padding:10px;box-shadow:0 0 0 1px #0001;outline:none}
figure:focus{box-shadow:0 0 0 2px #2563eb}
figure.done{opacity:.55}
body.disputes figure.done{opacity:1}body.disputes main{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}body.disputes img{height:260px}
p.rule{margin:0 0 8px;padding:6px 8px;border-radius:6px;background:#fff4d6;color:#5c4400}
.query{font-size:15px;font-weight:600;margin:0 0 8px}
img{width:100%;height:160px;object-fit:contain;background:#eee;border-radius:6px}
figure b{display:block;margin:6px 0 2px;font-weight:500}
p.file{margin:0 0 4px;color:#444}
p.desc{margin:0 0 8px;color:#777;font-size:12px}
.pick{display:flex;gap:6px}
button{flex:1;font:inherit;padding:6px 4px;border-radius:6px;border:1px solid #0002;background:#fff;cursor:pointer}
button[aria-pressed=true]{background:#222;color:#fff;border-color:#222}
input{width:100%;box-sizing:border-box;margin-top:6px;font:inherit;padding:5px 6px;border:1px solid #0002;border-radius:6px}
</style>
<header><h1>You searched for this. What does the asset give you?</h1><p><span id="count"></span>. Judge what the download holds, not the preview. <b>One</b>: the thing you asked for, ready to use. A pair (gloves, crutches) or a kit you asked for by name counts as One. <b>Several</b>: you get many and pick or place them, like a piece from a kit, a pack of plants, or one model in several versions (clean and rusted, open and closed). <b>Not it</b>: not what you asked for. <b>Unsure</b>: you can't tell, so it isn't scored. Focus a card and press 1, 2, 3 or 4. Notes save when you leave the field.</p></header>
<main id="cards"></main>
<script>
let labels = "__LABELS__";
const disputes = "__DISPUTES__";
if (disputes) document.body.classList.add("disputes");
const params = new URLSearchParams(location.search);
const only = params.get("ids")?.split(",");
if (params.has("blind")) for (const i of only ?? []) for (const k of Object.keys(labels)) if (k.startsWith(i + "::")) delete labels[k];
const items = ${JSON.stringify(pairs)}.filter((i) => (!only || only.includes(i.id)) && (!disputes || i.pair in disputes) && (!params.get("split") || i.split === params.get("split"))).sort((a, b) => !!labels[a.pair]?.answer - !!labels[b.pair]?.answer || (a.split === "dev") - (b.split === "dev"));
const save = (pair) => fetch("/labels", { method: "POST", body: JSON.stringify({ pair, label: labels[pair] ?? null }) });
const count = () => (document.getElementById("count").textContent = items.filter((i) => labels[i.pair]?.answer).length + " of " + items.length + " answered");
function render(item, fig) {
  const l = labels[item.pair] ?? {};
  fig.className = l.answer ? "done" : "";
  fig.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.answer === l.answer)));
  count();
}
const cards = document.getElementById("cards");
for (const item of items) {
  const fig = document.createElement("figure");
  fig.tabIndex = 0;
  fig.innerHTML = '<p class="query"></p><img alt="" src="/thumbs/' + item.id + '.png"><b></b><p class="file"></p><p class="desc"></p>' + (disputes ? '<p class="rule"></p>' : '') +
    '<div class="pick"><button data-answer="one">One</button><button data-answer="several">Several</button><button data-answer="miss">Not it</button><button data-answer="unsure">Unsure</button></div><input placeholder="Note (optional)">';
  fig.querySelector(".query").textContent = "\\u201c" + item.query + "\\u201d";
  fig.querySelector("b").textContent = item.name;
  fig.querySelector(".file").textContent = "In the file: " + item.file;
  fig.querySelector(".desc").textContent = item.description;
  if (disputes) fig.querySelector(".rule").textContent = disputes[item.pair];
  const input = fig.querySelector("input");
  input.value = labels[item.pair]?.note ?? "";
  const pick = (answer) => {
    labels[item.pair] = { ...labels[item.pair], answer: labels[item.pair]?.answer === answer ? undefined : answer };
    save(item.pair);
    render(item, fig);
  };
  fig.querySelectorAll("button").forEach((b) => (b.onclick = () => pick(b.dataset.answer)));
  fig.addEventListener("keydown", (e) => {
    if (e.target !== fig) return;
    if (e.key === "1") pick("one");
    if (e.key === "2") pick("several");
    if (e.key === "3") pick("miss");
    if (e.key === "4") pick("unsure");
  });
  input.addEventListener("change", () => {
    labels[item.pair] = { ...labels[item.pair], note: input.value || undefined };
    save(item.pair);
  });
  cards.append(fig);
  render(item, fig);
}
</script>`;

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer((req, res) => {
    const thumb = req.url.match(/^\/thumbs\/([\w-]+)\.png$/);
    if (thumb && existsSync(new URL(`thumbs/${thumb[1]}.png`, INDEX))) {
      res.writeHead(200, { "content-type": "image/png" }).end(readFileSync(new URL(`thumbs/${thumb[1]}.png`, INDEX)));
    } else if (req.url === "/labels" && req.method === "POST") {
      let body = "";
      req.on("data", (d) => (body += d)).on("end", () => {
        const { pair, label } = JSON.parse(body);
        const all = labels();
        if (label && (label.answer || label.note)) all[pair] = { answer: label.answer, note: label.note };
        else delete all[pair];
        writeFileSync(LABELS, JSON.stringify(all, null, 1));
        res.writeHead(204).end();
      });
    } else if (req.url.split("?")[0] === "/") {
      res.writeHead(200, { "content-type": "text/html" }).end(
        page.replace('"__LABELS__"', JSON.stringify(labels())).replace('"__DISPUTES__"', JSON.stringify(req.url.includes("disputes") ? disputesNow() : null)),
      );
    } else res.writeHead(404).end();
  }).listen(PORT, "127.0.0.1", () => console.log(`review ${pairs.length} pairs at http://127.0.0.1:${PORT}`));
}
