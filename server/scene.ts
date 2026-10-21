import type { Asset } from "../src/api.ts";
import { PLAN_PROMPT, REVIEW_PROMPT, parsePlan, parseReview, type PlannedSection, type Review } from "../src/scene.ts";
import { candidateLines, generate } from "./compose.ts";

const plans = new Map<string, PlannedSection[]>();
const reviews = new Map<string, Review>();

export async function planScene(query: string): Promise<PlannedSection[]> {
  const key = query.trim().toLowerCase();
  const hit = plans.get(key);
  if (hit) return hit;
  const text = await generate(PLAN_PROMPT, query.trim());
  const sections = parsePlan(text);
  plans.set(key, sections);
  return sections;
}

export async function reviewScene(query: string, sections: (PlannedSection & { assets: Asset[] })[]): Promise<Review> {
  const cacheKey = `${query.trim().toLowerCase()}\u0000${sections.map((s) => `${s.name}:${s.query}:${s.assets.map((a) => a.id).join(",")}`).join("|")}`;
  const hit = reviews.get(cacheKey);
  if (hit) return hit;
  const lines = [`Search: ${query.trim()}`];
  let offset = 0;
  for (const s of sections) {
    lines.push(`${s.name} = Section(${JSON.stringify(s.title)}, ${JSON.stringify(s.query)})`);
    const block = candidateLines(s.assets, offset);
    if (block) lines.push(block);
    offset += s.assets.length;
  }
  const text = await generate(REVIEW_PROMPT, lines.join("\n"));
  const review = parseReview(text, sections);
  reviews.set(cacheKey, review);
  return review;
}
