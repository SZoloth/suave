import { createLibrary, defineComponent, type Library } from "@openuidev/lang-core";
import type { Asset } from "../src/api.ts";
import { RULES, makeLibrary } from "../src/compose/schema.ts";
import { FACETS, FACET_KEYS } from "../src/facets.ts";
import { formatMetres, size } from "../src/parse.ts";

let system: string | undefined;

/** Built on first use: createLibrary draws a random id, which Cloudflare's runtime refuses while a module loads. */
export const systemPrompt = () =>
  (system ??= makeLibrary<Library>(defineComponent as never, createLibrary as never, {
    Results: null,
    Group: null,
    Lineup: null,
    Pick: null,
    Facet: null,
    Value: null,
  }).prompt({
    preamble: "You lay out asset library search results for animation artists. The user message is the search and the assets retrieval found for it.",
    additionalRules: RULES,
    examples: [
      `root = Results([withArms, stools], ["only the wooden ones", "tallest first"], [arms])\nwithArms = Group("With arms", [3, 1, 7])\nstools = Group("Stools", [12, 9])\narms = Facet("Arms", [Value("With arms", [3, 1, 7]), Value("No arms", [12, 9, 4])])`,
    ],
  }));

/** The first is better at layouts; the second answers when the first is busy (503) or out of quota (429). */
export const COMPOSE_MODELS = process.env.COMPOSE_MODEL ? [process.env.COMPOSE_MODEL] : ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
export const COMPOSE_MODEL = COMPOSE_MODELS[0];

const day = (iso?: string) => iso?.slice(0, 10);

/** `1 | Wooden chair | furniture, chair, wood | 92 cm tall | by Ana | …`: every field the asset has, so a search can group by any of them. Numbers keep ids out of the model's output. */
export function candidateLines(assets: Asset[], start = 0): string {
  return assets
    .map((a, i) => {
      const s = size(a);
      const changed = a.lastModifiedAt && `changed ${day(a.lastModifiedAt)}${a.lastModifiedBy ? ` by ${a.lastModifiedBy}` : ""}`;
      return [
        String(i + 1 + start),
        a.name,
        [...a.categories, ...a.tags].slice(0, 8).join(", "),
        s && `${formatMetres(s.h)} tall`,
        a.author && `by ${a.author}`,
        a.createdAt && `added to the library ${day(a.createdAt)}`,
        changed,
        ...FACET_KEYS.map((key) => {
          const shown = a[key] && (FACETS[key].values as Record<string, string>)[a[key]];
          return shown && `${FACETS[key].label.toLowerCase()} ${shown}`;
        }),
        a.collections.length > 0 && `in ${a.collections.slice(0, 3).join(", ")}`,
        (a.description ?? "").replace(/^Free \w+ model( of)?\.?\s*/i, "").slice(0, 140),
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");
}

const programs = new Map<string, string>();

export async function generate(system: string, user: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  let res: Response | null = null;
  for (const model of COMPOSE_MODELS) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, thinkingConfig: model.startsWith("gemini-2") ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" } },
      }),
    });
    if (res.status !== 503 && res.status !== 429) break;
  }
  if (!res?.ok) throw new Error(`Gemini ${res?.status}: ${(await res?.text())?.slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number };
  };
  const u = data.usageMetadata;
  if (u && process.env.COMPOSE_USAGE) console.error(`usage ${u.promptTokenCount} in, ${u.cachedContentTokenCount ?? 0} cached, ${u.candidatesTokenCount ?? 0} out`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

/** The model's OpenUI Lang program for one search and set. Cached by both, so a repeated search is free. */
export async function compose(query: string, assets: Asset[], groupBy?: string): Promise<string> {
  const layout = groupBy?.trim();
  const cacheKey = `${query.trim().toLowerCase()}\u0000${layout ?? ""}\u0000${assets.map((a) => a.id).join(",")}`;
  const hit = programs.get(cacheKey);
  if (hit != null) return hit;
  const user = [
    `Search: ${query}`,
    layout && `Group the assets by ${layout}. Use each group's value as the group title.`,
    "",
    `Assets:\n${candidateLines(assets)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const program = await generate(systemPrompt(), user);
  programs.set(cacheKey, program);
  return program;
}
