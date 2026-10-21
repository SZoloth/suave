import type { Asset } from "./api.ts";

/** Modeling stages a version can stand for, oldest first. `look` approximates that stage from the current thumbnail. */
const STAGES = [
  { stage: "Blockout", note: "Rough proportions", look: "grayscale(1) contrast(0.55) brightness(1.2) blur(2px)" },
  { stage: "Sculpt", note: "Shape and detail", look: "grayscale(1) contrast(1.15)" },
  { stage: "Retopo and UVs", note: "Clean mesh, unwrapped", look: "grayscale(0.85) sepia(0.25) contrast(1.05)" },
  { stage: "Texture", note: "First texture pass", look: "saturate(0.55) contrast(0.95)" },
  { stage: "Look dev", note: "Shading signed off", look: "none" },
] as const;

export type Version = { n: number; stage: (typeof STAGES)[number]["stage"]; note: string; look: string; by: string; at: number };

const DAY = 86_400_000;

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * A sample version history. The stand-in Library keeps only the current version, so the steps between creation and the last change are made up,
 * seeded by the asset id so they stay put between visits.
 */
export function versionsOf(asset: Asset): Version[] {
  const count = 2 + (hash(asset.id) % 4);
  const end = Date.parse(asset.lastModifiedAt ?? "") || Date.parse(asset.createdAt ?? "") || 0;
  const start = Date.parse(asset.createdAt ?? "") || end - (count - 1) * 7 * DAY;
  const first = asset.author ?? asset.lastModifiedBy ?? "Unknown";
  const last = asset.lastModifiedBy ?? asset.author ?? "Unknown";
  return STAGES.slice(-count).map((s, i) => ({
    n: i + 1,
    ...s,
    by: i === count - 1 ? last : i === 0 ? first : (hash(asset.id + i) % 2 ? first : last),
    at: Math.round(start + ((end - start) * i) / (count - 1)),
  }));
}
