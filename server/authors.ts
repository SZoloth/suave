import metadata from "../embed/index/metadata.json" with { type: "json" };

const people = [...new Set(Object.values(metadata as Record<string, { author: string | null }>).flatMap((m) => m.author?.split(", ") ?? []))];

const words = (s: string) => s.toLowerCase().match(/[a-z\u00c0-\u024f]+/g) ?? [];

/** A catalog author whose full name or surname appears as whole words in the text. */
export function matchAuthor(text: string): string | null {
  const said = ` ${words(text).join(" ")} `;
  const hits = people.filter((p) => {
    const w = words(p);
    return said.includes(` ${w.join(" ")} `) || (w.length > 1 && w.at(-1)!.length > 3 && said.includes(` ${w.at(-1)} `));
  });
  return hits.length === 1 ? hits[0] : (hits.find((p) => said.includes(` ${words(p).join(" ")} `)) ?? null);
}
