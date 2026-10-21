import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";
import { createLibrary, defineComponent, type Library } from "@openuidev/lang-core";
import { type Facet, facetsOf, usableFacets } from "../../src/compose/program.ts";
import { makeLibrary } from "../../src/compose/schema.ts";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
process.env.GEMINI_API_KEY ??= env?.[1].trim().replace(/^["']|["']$/g, "");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
if (arg("model")) process.env.COMPOSE_MODEL = arg("model");
const { compose, COMPOSE_MODEL } = await import("../../server/compose.ts");

const library = makeLibrary<Library>(defineComponent as never, createLibrary as never, { Results: null, Group: null, Lineup: null, Pick: null, Facet: null, Value: null });
const parser = createParser(library.toJSONSchema(), "Results");
const queries = arg("query") ? [arg("query")!] : ["chairs", "lamps", "wooden crates", "trees", "barrels", "tables, then only the round ones"];
const out = arg("out");
if (out) mkdirSync(out, { recursive: true });

const metadata: Record<string, object> = JSON.parse(readFileSync(new URL("../../embed/index/metadata.json", import.meta.url), "utf8"));
const about = (arg("about") ?? "").trim();
const facetLine = (f: Facet) => `${f.label}: ${f.values.map((v) => `${v.label} ${v.assets.length}`).join(", ")}`;

for (const query of queries) {
  const search = await fetch("http://127.0.0.1:8765/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: about || query, space: "fused", k: 40 }),
  }).then((r) => r.json());
  search.semantic = search.semantic.map((a: { id: string }) => ({ collections: [], ...a, ...metadata[a.id] }));
  const started = performance.now();
  const text = await compose(query, search.semantic.slice(0, 40));
  const total = performance.now() - started;
  if (out) writeFileSync(`${out}/${query.replace(/\W+/g, "_")}.lang`, text);
  const parsed = parser.parse(text);
  const errors = (parsed.meta?.errors ?? []).filter((e: { severity?: string }) => e.severity !== "warning");
  console.log(`\n## ${query}  [${COMPOSE_MODEL}] ${Math.round(total)} ms, ${text.length} chars, ${errors.length} errors`);
  console.log(text.trim().replace(/\[([\d,\s]+)\]/g, (_, ns: string) => `[${ns.split(",").map((n) => search.semantic[Number(n) - 1]?.name ?? `?${n}`).join(", ")}]`));
  for (const e of errors) console.log(`  ! ${e.code} ${e.statementId ?? ""} ${e.message}`);
  const kept = usableFacets(text);
  for (const f of facetsOf(text)) console.log(`  ${kept.some((k) => k.label === f.label) ? "facet" : "dropped"}  ${facetLine(f)}`);
}
