import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { checkMembership, describe, type Candidate } from "../../server/jev.ts";

const APP = new URL("../..", import.meta.url).pathname;
const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const get = (k: string) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
process.env.TYPESAFE_API_KEY = get("TYPESAFE_API_KEY");
const CACHE = new URL("../results/clef-membership.json", import.meta.url);

const KIND = "Is this asset the kind of object the search is for? Ignore material, colour and other details.";
const DETAILS = "Does this asset have every detail the search asks for, such as material, colour, condition or parts? Answer yes if the search asks for no details.";
const assets = new Map<string, Candidate>(JSON.parse(readFileSync(`${APP}/embed/index/assets.json`, "utf8")).map((a: Candidate) => [a.id, a]));
type Group = { about: string; reviewedAt?: string; candidates: { id: string }[]; labels: Record<string, boolean> };
const { queries } = JSON.parse(readFileSync(`${APP}/eval/membership.json`, "utf8")) as { queries: Record<string, Group> };
const groups = Object.values(queries).filter((g) => g.reviewedAt);

const mime = (b: Buffer) => (b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : "image/webp");
const thumb = (id: string) => {
  const b = readFileSync(`${APP}/embed/index/thumbs/${id}.png`);
  return `data:${mime(b)};base64,${b.toString("base64")}`;
};

async function clef(search: string, id: string, withImage: boolean): Promise<number> {
  const asset = describe(assets.get(id)!);
  const body = {
    model: "clef",
    state: { search, asset: withImage ? `${asset} The picture is this asset's thumbnail.` : asset },
    ...(withImage ? { images: [thumb(id)] } : {}),
    questions: { kind: { type: "noul", instructions: KIND }, details: { type: "noul", instructions: DETAILS } },
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${get("CLOUDFLARE_ACCOUNT_ID")}/ai/run/@cf/cloudflare/clef`, {
      method: "POST",
      headers: { Authorization: `Bearer ${get("CLOUDFLARE_AUTH_TOKEN")}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const a = (await res.json()).result.answers;
      return a.kind.noul * a.details.noul;
    }
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${id} ${res.status} ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
}

async function pool<T>(items: T[], run: (t: T) => Promise<void>, n = 8) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) await run(items[next++]); }));
}

type Fits = Record<string, Record<string, Record<string, number>>>;
const fits: Fits = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const variants = ["Jev", "Clef text", "Clef text + thumbnail"] as const;
for (const v of variants) {
  fits[v] ??= {};
  const started = performance.now();
  for (const g of groups) {
    const ids = g.candidates.map((c) => c.id).filter((id) => g.labels[id] !== undefined);
    const have = fits[v][g.about] ?? {};
    const todo = ids.filter((id) => have[id] === undefined);
    if (!todo.length) continue;
    if (v === "Jev")
      for (let i = 0; i < todo.length; i += 12) {
        const batch = todo.slice(i, i + 12).map((id) => assets.get(id)!);
        Object.assign(have, await checkMembership(g.about, batch).catch(() => checkMembership(g.about, batch)));
      }
    else await pool(todo, async (id) => { have[id] = await clef(g.about, id, v === "Clef text + thumbnail"); });
    fits[v][g.about] = have;
    writeFileSync(CACHE, JSON.stringify(fits));
  }
  console.log(`${v}: scored in ${Math.round((performance.now() - started) / 1000)} s`);
}

const mistakes = (v: string, cut: number) =>
  groups.flatMap((g) =>
    Object.entries(fits[v][g.about]).flatMap(([id, fit]) => {
      const label = g.labels[id];
      return label === fit >= cut ? [] : [{ key: `${g.about} :: ${assets.get(id)!.name}`, about: g.about, id, kind: label ? "missing" : "wrong", fit }];
    }),
  );
const total = groups.reduce((n, g) => n + Object.keys(fits.Jev[g.about]).length, 0);
console.log(`\n${total} labeled pairs`);
for (const v of variants) {
  const at = mistakes(v, 0.5);
  const cuts = Array.from({ length: 19 }, (_, i) => (i + 1) / 20).map((c) => [c, mistakes(v, c).length] as const);
  const [bestCut, bestN] = cuts.reduce((a, b) => (b[1] < a[1] ? b : a));
  console.log(`${v}: ${at.length} mistakes at 0.5 (${at.filter((m) => m.kind === "wrong").length} wrong, ${at.filter((m) => m.kind === "missing").length} missing); fewest ${bestN} at ${bestCut}`);
}
const jev = new Set(mistakes("Jev", 0.5).map((m) => m.key));
for (const v of variants.slice(1)) {
  const cut = Number(process.env.CUT ?? 0.5);
  const theirs = mistakes(v, cut);
  const keys = new Set(theirs.map((m) => m.key));
  console.log(`\n${v} at ${cut}: fixes ${[...jev].filter((k) => !keys.has(k)).length} of Jev's ${jev.size}, adds ${theirs.filter((m) => !jev.has(m.key)).length}`);
  for (const m of mistakes("Jev", 0.5)) console.log(`  ${keys.has(m.key) ? "still" : "FIXED"} ${m.kind.padEnd(7)} ${m.key} (Jev ${m.fit.toFixed(2)}, ${v} ${fits[v][m.about][m.id].toFixed(2)})`);
  for (const m of theirs.filter((m) => !jev.has(m.key))) console.log(`  new   ${m.kind.padEnd(7)} ${m.key} (${m.fit.toFixed(2)})`);
}
