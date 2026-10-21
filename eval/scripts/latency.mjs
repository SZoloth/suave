// Time from the last keystroke to the results an artist waits for, in a real browser.
// node eval/scripts/latency.mjs --base http://127.0.0.1:5197 [--base http://127.0.0.1:5198] [--n 5] [--label name]
// With two --base values the runs alternate between them, so drift and warmup favour neither.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const QUERIES = [
  "rusty lanterns",
  "all barrels",
  "wooden chairs tallest first",
  "crates changed this week",
  "props for a pirate ship deck",
  "a dandelion",
  "cannon ball",
  "compare a barrel and a crate",
];
const { values } = parseArgs({
  options: {
    base: { type: "string", multiple: true, default: ["http://127.0.0.1:5197"] },
    n: { type: "string", default: "5" },
    delay: { type: "string", default: "70" },
    label: { type: "string", default: "run" },
    query: { type: "string", multiple: true },
  },
});
const N = Number(values.n);
const queries = values.query ?? QUERIES;
const QUIET_MS = 1500;
const TOP = 12;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const overlap = (a, b) => (a.length ? a.slice(0, TOP).filter((id) => b.slice(0, TOP).includes(id)).length / Math.min(TOP, a.length) : 1);

async function run(browser, base, query) {
  await fetch(`${base}/api/cache`, { method: "DELETE" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (!/^\/(api|retrieval)\//.test(path)) return;
    calls.push(path);
    if (r.status() >= 400) errors.push(`${r.status()} ${path}`);
  });
  await page.addInitScript(() => {
    window.__lastKey = 0;
    addEventListener("keydown", () => (window.__lastKey = performance.now()), true);
  });
  await page.goto(base);
  const box = page.getByRole("textbox").first();
  await box.waitFor();
  await page.waitForTimeout(1000);
  calls.length = 0;
  await box.pressSequentially(query, { delay: Number(values.delay) });
  const marks = (name) =>
    page.evaluate(
      ([n, q]) => performance.getEntriesByName(n).filter((e) => e.detail?.query === q).map((e) => ({ at: e.startTime, ids: e.detail.ids, count: e.detail.count ?? e.detail.ids.length })),
      [name, query],
    );
  try {
    await page.waitForFunction((q) => performance.getEntriesByName("suave:settled").some((e) => e.detail?.query === q), query, { timeout: 20000 });
  } catch {
    errors.push("timeout waiting for settled");
  }
  let settled = await marks("suave:settled");
  for (;;) {
    await page.waitForTimeout(QUIET_MS);
    const again = await marks("suave:settled");
    if (again.length === settled.length) break;
    settled = again;
  }
  const cards = await marks("suave:cards");
  const lastKey = await page.evaluate(() => window.__lastKey);
  const stages = await page.evaluate(
    (k) =>
      performance
        .getEntriesByType("resource")
        .filter((e) => /\/(api|retrieval)\//.test(e.name) && e.responseEnd > k)
        .map((e) => ({ path: new URL(e.name).pathname, start: Math.round(e.startTime - k), end: Math.round(e.responseEnd - k) })),
    lastKey,
  );
  await page.close();
  const final = settled.at(-1);
  const first = cards[0] ?? settled[0];
  return {
    base,
    query,
    settledMs: final ? Math.round(final.at - lastKey) : null,
    firstCardsMs: first ? Math.round(first.at - lastKey) : null,
    settles: settled.length,
    firstVsFinal: first && final ? overlap(first.ids, final.ids) : null,
    results: final?.count ?? 0,
    ids: final?.ids ?? [],
    stages,
    calls: Object.fromEntries([...new Set(calls)].map((c) => [c, calls.filter((x) => x === c).length])),
    errors,
  };
}

const browser = await chromium.launch();
const rows = [];
for (let rep = 0; rep < N; rep++) {
  for (const query of queries) {
    const order = rep % 2 ? [...values.base].reverse() : values.base;
    for (const base of order) {
      const r = await run(browser, base, query);
      rows.push(r);
      const waterfall = r.stages.map((s) => `${s.path.split("/").pop()} ${s.start}-${s.end}`).join(" | ");
      console.log(`${base.slice(-4)} ${query.padEnd(30)} settled ${String(r.settledMs).padStart(5)}ms  first ${String(r.firstCardsMs).padStart(5)}ms  results ${r.results}  ${waterfall}  ${r.errors.join("; ")}`);
    }
  }
}
await browser.close();

const summary = values.base.map((base) => {
  const mine = rows.filter((r) => r.base === base);
  const ok = mine.filter((r) => r.settledMs != null && r.errors.length === 0);
  const perQuery = Object.fromEntries(
    queries.map((q) => {
      const qs = ok.filter((r) => r.query === q);
      return [q, { settled: median(qs.map((r) => r.settledMs)), first: median(qs.map((r) => r.firstCardsMs)), results: median(qs.map((r) => r.results)) }];
    }),
  );
  const settled = ok.map((r) => r.settledMs);
  const first = ok.map((r) => r.firstCardsMs);
  return {
    base,
    runs: mine.length,
    errors: mine.length - ok.length,
    settled: { median: median(settled), p90: pct(settled, 0.9), min: Math.min(...settled), max: Math.max(...settled) },
    firstCards: { median: median(first), p90: pct(first, 0.9) },
    firstVsFinal: median(ok.map((r) => r.firstVsFinal)),
    extraSettles: ok.filter((r) => r.settles > 1).length,
    perQuery,
  };
});
for (const s of summary) {
  console.log(`\n${s.base}  runs ${s.runs}  errors ${s.errors}  extra settles ${s.extraSettles}`);
  console.log(`  last key → settled   median ${s.settled.median}ms  p90 ${s.settled.p90}ms  range ${s.settled.min}-${s.settled.max}ms`);
  console.log(`  last key → first cards median ${s.firstCards.median}ms  p90 ${s.firstCards.p90}ms  first-vs-final top-${TOP} overlap ${s.firstVsFinal}`);
  for (const [q, v] of Object.entries(s.perQuery)) console.log(`    ${q.padEnd(30)} ${String(v.settled).padStart(5)}ms  first ${String(v.first).padStart(5)}ms  results ${v.results}`);
}
if (values.base.length === 2) {
  const [a, b] = values.base;
  const finalIds = (base, q) => rows.filter((r) => r.base === base && r.query === q && r.errors.length === 0).map((r) => r.results);
  const agree = queries.map((q) => {
    const ra = rows.filter((r) => r.base === a && r.query === q).at(-1);
    const rb = rows.filter((r) => r.base === b && r.query === q).at(-1);
    return [q, median(finalIds(a, q)), median(finalIds(b, q)), ra && rb ? overlap(ra.ids ?? [], rb.ids ?? []) : null];
  });
  console.log(`\nResult agreement, ${a.slice(-4)} vs ${b.slice(-4)} (median results each, top-${TOP} overlap of the last runs)`);
  for (const [q, na, nb, o] of agree) console.log(`  ${q.padEnd(30)} ${na} vs ${nb}  overlap ${o}${na !== nb || o < 0.9 ? "  ← differs" : ""}`);
}
const dir = resolve(import.meta.dirname, "../results");
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `latency-${values.label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify({ queries, n: N, summary, rows }, null, 2)}\n`);
console.log(`\n${file}`);
