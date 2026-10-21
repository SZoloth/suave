import { readFileSync } from "node:fs";
import { classifyWithJev } from "../../server/jev.ts";

const APP = new URL("../..", import.meta.url).pathname;
for (const line of readFileSync(`${APP}/.env.local`, "utf8").split("\n")) {
  const m = line.match(/^(TYPESAFE_API_KEY)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

type Line = { previous: string; text: string; narrows: boolean; groupBy?: string };
const { lines } = JSON.parse(readFileSync(`${APP}/eval/followup-reads.json`, "utf8")) as { lines: Line[] };
const RUNS = Number(process.env.RUNS ?? 1);

let misses = 0;
for (const l of lines) {
  for (let run = 0; run < RUNS; run++) {
    const intent = await classifyWithJev(l.text, l.previous);
    const narrows = intent.followUp?.narrows ?? 0;
    const groupBy = intent.plan.groupBy.value;
    const wrong = [
      (narrows >= 0.5) !== l.narrows && `narrows ${narrows.toFixed(2)}, expected ${l.narrows ? "yes" : "no"}`,
      l.groupBy && groupBy !== l.groupBy && `groupBy ${groupBy}, expected ${l.groupBy}`,
    ].filter(Boolean);
    if (wrong.length) {
      misses++;
      console.log(`MISS "${l.text}" after "${l.previous}": ${wrong.join("; ")} (about "${intent.plan.about}")`);
    }
  }
}
console.log(`${lines.length * RUNS - misses} of ${lines.length * RUNS} reads as expected`);
process.exitCode = misses ? 1 : 0;
