import assert from "node:assert/strict";
import { test } from "node:test";
import { BadBody, handleApi } from "./api.ts";

const call = (path: string, method = "GET", body: Record<string, unknown> = {}) => handleApi(path, method, async () => body, { publicDemo: true });

test("a public deploy never serves logged artist queries or eval files", async () => {
  assert.equal((await call("/api/real-queries")).status, 404);
  assert.equal((await call("/api/eval/membership")).status, 404);
  assert.equal((await call("/api/eval/membership", "POST", { a: 1 })).status, 404);
});

test("a public deploy keeps collections in the browser instead of writing to Library", async () => {
  const made = await call("/api/collections", "POST", { name: "Tavern lamps", assets: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  assert.equal(made.status, 200);
  assert.deepEqual({ ...(made.body as object), id: "x" }, { id: "x", name: "Tavern lamps", items: 2 });
  assert.deepEqual(await call("/api/collections/demo-1/items", "POST", { assets: [{ id: "c", name: "C" }] }), { status: 200, body: { items: 1 } });
});

test("an unknown route is a 404", async () => {
  assert.equal((await call("/api/nope")).status, 404);
});

test("scene rejects a bad body before Gemini", async () => {
  await assert.rejects(() => call("/api/scene", "POST", { step: "nope", query: "war zone" }), BadBody);
  await assert.rejects(() => call("/api/scene", "POST", { step: "plan" }), BadBody);
});

test("scene without Gemini key returns empty shapes", async (t) => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  t.after(() => {
    if (saved) process.env.GEMINI_API_KEY = saved;
    else delete process.env.GEMINI_API_KEY;
  });
  const plan = await call("/api/scene", "POST", { step: "plan", query: "birthday party" });
  assert.deepEqual(plan.body, { sections: [] });
  const review = await call("/api/scene", "POST", {
    step: "review",
    query: "birthday party",
    sections: [{ name: "a", title: "Balloons", query: "balloon", assets: [{ id: "1", name: "Balloon", categories: [], tags: [], collections: [], description: "", dimensions_mm: [], score: 1 }] }],
  });
  assert.deepEqual(review.body, { verdicts: {}, facets: [] });
});

test("a public deploy charges Jev and Gemini against one hourly budget, by size", async (t) => {
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    asked.push(String(url instanceof Request ? url.url : url));
    return new Response("{}", { status: 400 });
  }) as typeof fetch;
  Object.assign(process.env, { TYPESAFE_API_KEY: "test-key-not-real", GEMINI_API_KEY: "test-key-not-real", JEV_HOURLY_BUDGET: "3" });
  t.after(() => {
    globalThis.fetch = realFetch;
    for (const k of ["TYPESAFE_API_KEY", "GEMINI_API_KEY", "JEV_HOURLY_BUDGET"]) delete process.env[k];
  });
  const candidates = Array.from({ length: 600 }, (_, i) => ({ id: `a${i}`, name: "Chair", categories: [], tags: [], description: "" }));
  assert.deepEqual((await call("/api/members", "POST", { search: "chairs", candidates })).body, { fit: null });
  assert.equal(asked.length, 0, "600 candidates cost more than the whole budget, so Jev is never asked");
  for (const n of [1, 2, 3, 4]) await call("/api/title", "POST", { lines: ["all chairs", `only ${n}`] });
  assert.equal(asked.length, 3, "titles past the budget never reach Gemini");
});

test("router=local takes view and count from the retrieval server and keeps the rest", async (t) => {
  const realFetch = globalThis.fetch;
  let up = true;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (!String(url).endsWith("/route") || !up) throw new Error("retrieval server down");
    const heads = { view: { value: "compare", confidence: 0.9, probabilities: { compare: 0.9 } }, count: { value: "group", confidence: 0.8, probabilities: { group: 0.8 } } };
    return new Response(JSON.stringify({ heads }));
  }) as typeof fetch;
  t.after(() => (globalThis.fetch = realFetch));
  const read = async (router?: string) => (await call("/api/intent", "POST", { query: "pile of rocks next to a barrel", router })).body as Record<string, any>;
  const jev = await read();
  const local = await read("local");
  assert.equal(local.router, "local");
  assert.deepEqual([local.view.value, local.count.value], ["compare", "group"]);
  assert.deepEqual(local.plan, jev.plan, "only view and count change");
  up = false;
  const fallback = await read("local");
  assert.equal(fallback.router, undefined, "a missing router never claims to be local");
  assert.deepEqual(fallback.view, jev.view);
});
