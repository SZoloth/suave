import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { predict, type Holds } from "../../src/multiplicity.ts";
import { pairs } from "../../embed/vision-review.mjs";

const EMBED = new URL("../../embed/", import.meta.url);
const key = readFileSync(new URL("../../.env.local", import.meta.url), "utf8").match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
const MODEL = process.env.MODEL ?? "claude-haiku-5-5";
const OUT = new URL(`../results/${MODEL}-contents.json`, import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, EMBED), "utf8"));

const source = readFileSync(new URL("vision-contents.mjs", EMBED), "utf8");
const PROMPT = source.match(/const PROMPT = `([\s\S]*?)`;/)![1];
const files = read("vision/files.json");
const holds: Record<string, Holds> = read("vision/holds.json");
const labels: Record<string, { answer: string }> = read("vision/pair-labels.json");

const schema = {
  type: "object",
  properties: {
    hero: { type: "string" },
    contents: { type: "array", items: { type: "object", properties: { thing: { type: "string" }, count: { type: "integer" } }, required: ["thing", "count"] } },
    versions: { type: "array", items: { type: "string" } },
  },
  required: ["hero", "contents", "versions"],
};
const usage = { input: 0, output: 0 };
const mediaType = (b: Buffer) =>
  b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : b.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "image/gif";

async function ask(id: string) {
  const file = files[id];
  const names = file.objects.map((o: { name: string }) => o.name.trim());
  const thumb = readFileSync(new URL(`index/thumbs/${id}.png`, EMBED));
  const facts = `Asset id: ${id}. Description: ${file.description || "none"}. Objects in the file (${names.length}): ${names.slice(0, 60).join(", ")}${names.length > 60 ? ", …" : ""}.`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key ?? "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [{ name: "catalogue", description: "Record what this asset contains", input_schema: schema }],
        tool_choice: { type: "tool", name: "catalogue" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType(thumb), data: thumb.toString("base64") } },
              { type: "text", text: `${facts}\n\n${PROMPT}` },
            ],
          },
        ],
      }),
    });
    if (res.ok) {
      const json = await res.json();
      usage.input += json.usage.input_tokens;
      usage.output += json.usage.output_tokens;
      return json.content.find((c: { type: string }) => c.type === "tool_use").input;
    }
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${id} ${res.status} ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
  }
}

const ids = [...new Set(pairs.filter((p) => labels[p.pair]).map((p) => p.id))];
const out: Record<string, Omit<Holds, "objects"> | null> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = ids.filter((id) => !out[id]);
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < todo.length) {
      const id = todo[next++];
      out[id] = await ask(id).catch((e) => (console.error(e.message), null));
    }
  }),
);
writeFileSync(OUT, JSON.stringify(out, null, 1));
if (todo.length) console.log(`${MODEL}: ${todo.length} assets in ${Math.round((performance.now() - started) / 1000)} s, ${usage.input} input and ${usage.output} output tokens`);

const ANSWERS = ["one", "several", "miss"];
const readers = {
  "Gemini contents": (p: { id: string; query: string }) => predict(p.query, holds[p.id]).answer,
  [`${MODEL} contents`]: (p: { id: string; query: string }) => (out[p.id] ? predict(p.query, { ...out[p.id]!, objects: holds[p.id].objects }).answer : "none"),
};
for (const split of ["dev", "test", "hard", "blind", "all"]) {
  const scored = pairs.filter((p) => (split === "all" || p.split === split) && ANSWERS.includes(labels[p.pair]?.answer));
  if (!scored.length) continue;
  console.log(`\n${split}: ${scored.length} pairs`);
  for (const [name, says] of Object.entries(readers)) console.log(`  ${name}: ${scored.filter((p) => says(p) === labels[p.pair].answer).length}/${scored.length}`);
}
const flips = pairs.filter((p) => ANSWERS.includes(labels[p.pair]?.answer)).map((p) => ({ p, g: readers["Gemini contents"](p), h: readers[`${MODEL} contents`](p), t: labels[p.pair].answer })).filter((x) => x.g !== x.h);
console.log(`\n${flips.length} pairs where they disagree:`);
for (const { p, g, h, t } of flips) console.log(`  ${h === t ? "+" : g === t ? "-" : " "} "${p.query}" → ${p.id}: Gemini ${g}, ${MODEL} ${h}, labeled ${t}`);
