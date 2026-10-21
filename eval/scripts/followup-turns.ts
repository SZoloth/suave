import { readFileSync } from "node:fs";
import { classifyWithJev } from "../../server/jev.ts";

const APP = new URL("../..", import.meta.url).pathname;
for (const line of readFileSync(`${APP}/.env.local`, "utf8").split("\n")) {
  const m = line.match(/^(TYPESAFE_API_KEY)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

type Line = { text: string; expected: "new" | "refine" | "act" };
const { threads } = JSON.parse(readFileSync(`${APP}/eval/threads.json`, "utf8")) as { threads: { lines: Line[] }[] };

const clean = (q: string) =>
  q
    .replace(/^(please\s+)?((find|show|get|give)( me)?|i need|i want|looking for|search for)\s+/i, "")
    .replace(/^(some\s+)?(stuff|things|props|assets)\s+(for|from)\s+/i, "")
    .replace(/^(a|an|the|some)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim() || q;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let right = 0;
let total = 0;
let costly = 0;
for (const th of threads) {
  const abouts = new Map<number, string>();
  for (const [j, l] of th.lines.entries()) if (l.expected === "new") abouts.set(j, (await classifyWithJev(l.text)).plan.about);
  let steps: string[] = [];
  for (const [i, l] of th.lines.entries()) {
    if (i > 0) {
      const t = (await classifyWithJev(l.text, steps.join(", then "))).followUp?.turn;
      total++;
      if (t?.value === l.expected) right++;
      else {
        if (l.expected === "new" && t?.value === "refine") costly++;
        console.log(`MISS "${l.text}" after "${steps.join(", then ")}": expected ${l.expected}, read ${t?.value} at ${t?.confidence.toFixed(2)}`);
      }
    }
    if (l.expected === "new") steps = [cap(clean(abouts.get(i) ?? l.text))];
    else if (l.expected === "refine") steps.push(cap(clean(l.text)));
  }
}
console.log(`${right} of ${total} read as expected; ${costly} new searches read as refine`);
