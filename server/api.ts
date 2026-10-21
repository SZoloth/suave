import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Asset } from "../src/api.ts";
import type { Intent } from "../src/intent.ts";
import { type NewCollection, addItems, createCollection } from "./library.ts";
import { type Candidate, checkMembership, classifyWithJev, jevEnabled, pickCollection } from "./jev.ts";
import { classifyOffline } from "./offline.ts";
import { compose } from "./compose.ts";
import { planScene, reviewScene } from "./scene.ts";
import { threadTitle, titleEnabled } from "./title.ts";

const HERE = import.meta.dirname ?? process.cwd();
const REAL_QUERIES = process.env.REAL_QUERIES_FILE ?? "";
const EVALS = { membership: "membership.json", threads: "threads.json" } as const;
export const RETRIEVAL = process.env.RETRIEVAL_URL ?? "http://127.0.0.1:8765";

const cache = new Map<string, Intent>();
/** Fit per search, then per asset id. Jev's answer for the same asset wobbles by about 0.03 between calls, so asking again could flip an asset near the cutoff. */
const membership = new Map<string, Record<string, number>>();
/** Jev and Gemini calls per hour, per server instance, so a shared link can't run up usage; past it, reads fall back to the keyword rules. JEV_HOURLY_BUDGET overrides; a public demo without it still gets a cap. */
const DEMO_HOURLY_BUDGET = 300;
/** One membership call's worth of budget covers this many candidates, the pool a search checks. */
const CANDIDATES_PER_CALL = 60;
let spent = { hour: 0, calls: 0 };
/** The most assets one layout reads; past it the prompt grows without better groups. */
const COMPOSE_MAX = 40;
const SCENE_SECTIONS = 5;
const SCENE_ASSETS = 8;

function spend(publicDemo: boolean, calls = 1): boolean {
  const budget = Number(process.env.JEV_HOURLY_BUDGET) || (publicDemo ? DEMO_HOURLY_BUDGET : Number.POSITIVE_INFINITY);
  const hour = Math.floor(Date.now() / 3_600_000);
  if (spent.hour !== hour) spent = { hour, calls: 0 };
  if (spent.calls + calls > budget) return false;
  spent.calls += calls;
  return true;
}

const spendJev = (publicDemo: boolean, calls = 1) => jevEnabled() && spend(publicDemo, calls);

export class BadBody extends Error {}
export type Reply = { status: number; body: unknown };
type Body = () => Promise<Record<string, unknown>>;

const ok = (body: unknown, status = 200): Reply => ({ status, body });
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** View and count from the local router in the retrieval server, or null when it isn't running or has no heads. */
async function localHeads(text: string): Promise<Pick<Intent, "view" | "count"> | null> {
  try {
    const r = await fetch(`${RETRIEVAL}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: text }) });
    const { heads } = (await r.json()) as { heads?: Partial<Pick<Intent, "view" | "count">> };
    if (heads?.view && heads.count) return { view: heads.view, count: heads.count };
  } catch {}
  console.warn("[router] no local heads from the retrieval server; view and count stay Jev's");
  return null;
}

async function classify(text: string, allowJev: boolean, publicDemo: boolean, previous?: string, router: "jev" | "local" = "jev"): Promise<Intent> {
  if (router === "local") {
    const [intent, heads] = await Promise.all([classify(text, allowJev, publicDemo, previous), localHeads(text)]);
    return heads ? { ...intent, ...heads, router: "local" } : intent;
  }
  const key = `${allowJev}:${text.trim().toLowerCase()}|${previous?.toLowerCase() ?? ""}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, latencyMs: 0 };
  // Only while Jev reads. A cached or offline read answers at once, and the warm encode would then hold the lock the search needs.
  const useJev = allowJev && spendJev(publicDemo);
  if (useJev) fetch(`${RETRIEVAL}/warm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: text }) }).catch(() => {});
  let intent: Intent;
  try {
    intent = useJev ? await classifyWithJev(text, previous) : classifyOffline(text);
  } catch (err) {
    console.warn(`[jev] ${message(err)}; using keyword rules`);
    return classifyOffline(text);
  }
  if (useJev === allowJev) cache.set(key, intent);
  return intent;
}

async function realQueries(): Promise<Reply> {
  if (!REAL_QUERIES || !existsSync(REAL_QUERIES)) return ok({ jev: false, queries: [] });
  const allowJev = process.env.JEV_SEND_REAL_QUERIES === "1";
  const rows = readFileSync(REAL_QUERIES, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { date: string; query: string; result_count: number; click_ranks: number[]; import_clicked: boolean; import_successful: boolean });
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = r.query.trim().toLowerCase().replace(/\s+/g, " ");
    return !seen.has(k) && seen.add(k);
  });
  const queries = await Promise.all(
    unique.map(async ({ date, query, result_count, click_ranks, import_clicked, import_successful }) => ({
      date,
      query: query.replace(/\s+/g, " ").trim(),
      resultCount: result_count,
      clickRanks: click_ranks,
      importClicked: import_clicked,
      importSuccessful: import_successful,
      intent: await classify(query, allowJev, false),
    })),
  );
  return ok({ jev: allowJev && jevEnabled(), queries });
}

async function evalFile(name: string, method: string, body: Body): Promise<Reply> {
  if (!Object.hasOwn(EVALS, name)) return ok({ error: `unknown eval ${name}` }, 404);
  const file = resolve(HERE, "../eval", EVALS[name as keyof typeof EVALS]);
  if (method === "POST") {
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify(await body(), null, 2)}\n`);
    return ok({ ok: true });
  }
  return ok(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
}

async function collections(rest: string, body: Body, publicDemo: boolean): Promise<Reply> {
  const { name: rawName, discoverable, assets } = (await body()) as Partial<NewCollection>;
  const adding = rest.match(/^\/([^/]+)\/items$/);
  try {
    if (adding) {
      if (!assets?.length) return ok({ error: "Nothing to add" }, 400);
      return ok({ items: publicDemo ? assets.length : await addItems(decodeURIComponent(adding[1]), assets) });
    }
    const name = String(rawName ?? "").trim();
    if (!name || !assets?.length) return ok({ error: "A collection needs a name and at least one asset" }, 400);
    if (publicDemo) return ok({ id: `demo-${Date.now().toString(36)}`, name, items: assets.length });
    return ok(await createCollection({ name, discoverable: discoverable === true, assets }));
  } catch (err) {
    return ok({ error: message(err) }, 502);
  }
}

async function members(body: Body, publicDemo: boolean): Promise<Reply> {
  const b = await body();
  const search = String(b.search ?? "").trim();
  const candidates = Array.isArray(b.candidates) ? (b.candidates as Candidate[]) : [];
  if (!search || candidates.length === 0) return ok({ fit: null });
  const scores = (b.fresh ? undefined : membership.get(search.toLowerCase())) ?? {};
  const unasked = candidates.filter((c) => !(c.id in scores));
  if (unasked.length > 0 && !spendJev(publicDemo, Math.ceil(unasked.length / CANDIDATES_PER_CALL))) return ok({ fit: null });
  try {
    const started = performance.now();
    if (unasked.length > 0) Object.assign(scores, await checkMembership(search, unasked));
    membership.set(search.toLowerCase(), scores);
    return ok({ fit: Object.fromEntries(candidates.map((c) => [c.id, scores[c.id]])), latencyMs: Math.round(performance.now() - started) });
  } catch (err) {
    console.warn(`[jev] membership: ${message(err)}`);
    return ok({ fit: null });
  }
}

async function pick(body: Body, publicDemo: boolean): Promise<Reply> {
  const b = await body();
  const line = String(b.line ?? "").trim();
  const names = Array.isArray(b.names) ? b.names.filter((n: unknown): n is string => typeof n === "string") : [];
  if (!line || names.length === 0 || !spendJev(publicDemo)) return ok({ index: null, confidence: 0 });
  try {
    return ok(await pickCollection(line, names));
  } catch (err) {
    console.warn(`[jev] pick collection: ${message(err)}`);
    return ok({ index: null, confidence: 0 });
  }
}

/**
 * /api/intent         typed queries go to Jev when a key is set. `router: "local"` takes view and count from the retrieval server's /route.
 * /api/members        Jev scores whether each candidate belongs in the set the search describes.
 * /api/pick-collection  Jev names the collection a line refers to.
 * /api/title          Gemini rewrites a thread's lines into a plain-English title.
 * /api/compose        Gemini lays a result set out as groups, in OpenUI Lang.
 * /api/scene          Gemini plans and reviews multi-search scene pages.
 * /api/collections    creates a Library collection and its items (fake Library API by default).
 * /api/collections/:id/items  adds items to an existing one.
 * DELETE /api/cache  forgets cached reads, so a latency run times Jev rather than the cache. Local only.
 * /api/eval/<name>    reads and writes the labeled checks in eval/ (membership, threads). Local only.
 * /api/real-queries   queries from the JSONL file at REAL_QUERIES_FILE. Local only. They only
 *                     reach Jev when JEV_SEND_REAL_QUERIES=1.
 * A public demo never serves the local-only routes and never writes to Library.
 */
export async function handleApi(path: string, method: string, body: Body, { publicDemo = process.env.PUBLIC_DEMO === "1" } = {}): Promise<Reply> {
  const [, route = "", rest = ""] = path.match(/^\/api\/([^/]+)(.*)$/) ?? [];
  switch (route) {
    case "intent": {
      const b = await body();
      const previous = typeof b.previous === "string" && b.previous.trim() ? b.previous.trim() : undefined;
      return ok(await classify(String(b.query ?? ""), true, publicDemo, previous, b.router === "local" ? "local" : "jev"));
    }
    case "members":
      return members(body, publicDemo);
    case "pick-collection":
      return pick(body, publicDemo);
    case "title": {
      const lines = (await body()).lines;
      if (!Array.isArray(lines) || lines.length < 2 || !lines.every((l) => typeof l === "string" && l.trim())) throw new BadBody("lines: two or more strings");
      if (!titleEnabled() || !spend(publicDemo)) return ok({ title: null });
      return ok({ title: await threadTitle(lines.map((l: string) => l.trim()).slice(0, 8)).catch(() => null) });
    }
    case "compose": {
      const b = await body();
      if (typeof b.query !== "string" || !b.query.trim() || !Array.isArray(b.assets)) throw new BadBody("query: a string; assets: an array");
      if (!titleEnabled() || !spend(publicDemo)) return ok({ program: "" });
      const list = (v: unknown) => (Array.isArray(v) ? v : []);
      const assets = (b.assets as Partial<Asset>[])
        .slice(0, COMPOSE_MAX)
        .filter((a) => typeof a?.id === "string" && typeof a.name === "string")
        .map((a) => ({ ...a, categories: list(a.categories), tags: list(a.tags), collections: list(a.collections), dimensions_mm: list(a.dimensions_mm) }) as Asset);
      const rawGroup = b.groupBy;
      const groupBy = typeof rawGroup === "string" && rawGroup.trim().length > 0 && rawGroup.length <= 40 ? rawGroup.trim() : undefined;
      return ok({ program: await compose(b.query.trim(), assets, groupBy).catch(() => "") });
    }
    case "scene": {
      const b = await body();
      const step = b.step;
      const query = typeof b.query === "string" ? b.query.trim() : "";
      if (!query || (step !== "plan" && step !== "review")) throw new BadBody('step: "plan" or "review"; query: a string');
      if (!titleEnabled() || !spend(publicDemo)) {
        return step === "plan" ? ok({ sections: [] }) : ok({ verdicts: {}, facets: [] });
      }
      const list = (v: unknown) => (Array.isArray(v) ? v : []);
      const normAsset = (a: Partial<Asset>) =>
        ({ ...a, categories: list(a.categories), tags: list(a.tags), collections: list(a.collections), dimensions_mm: list(a.dimensions_mm) }) as Asset;
      const failed = <T,>(empty: T) => (e: unknown) => (console.error(`scene ${step}: ${e instanceof Error ? e.message : e}`), empty);
      if (step === "plan") return ok({ sections: await planScene(query).catch(failed([])) });
      if (!Array.isArray(b.sections)) throw new BadBody("sections: an array");
      const sections = (b.sections as { name?: unknown; title?: unknown; query?: unknown; assets?: unknown }[])
        .slice(0, SCENE_SECTIONS)
        .filter((s) => typeof s.name === "string" && typeof s.title === "string" && typeof s.query === "string")
        .map((s) => ({
          name: s.name as string,
          title: s.title as string,
          query: s.query as string,
          assets: list(s.assets)
            .slice(0, SCENE_ASSETS)
            .filter((a): a is Partial<Asset> => typeof (a as Partial<Asset>)?.id === "string" && typeof (a as Partial<Asset>)?.name === "string")
            .map(normAsset),
        }));
      return ok({ ...(await reviewScene(query, sections).catch(failed({ verdicts: {}, facets: [] }))) });
    }
    case "collections":
      return collections(rest, body, publicDemo);
    case "status":
      return ok({ jev: jevEnabled(), publicDemo });
    case "real-queries":
      return publicDemo ? ok({ error: "not found" }, 404) : realQueries();
    case "cache":
      if (publicDemo || method !== "DELETE") return ok({ error: "not found" }, 404);
      cache.clear();
      membership.clear();
      return ok({ ok: true });
    case "eval":
      return publicDemo ? ok({ error: "not found" }, 404) : evalFile(rest.slice(1), method, body);
    default:
      return ok({ error: "not found" }, 404);
  }
}
