import data from "../embed/vision/holds.json" with { type: "json" };
import { type Holds, names, predict } from "./multiplicity.ts";

const holds = data as Record<string, Holds>;

/** "3 to pick from" when the asset gives several of what was searched for; nothing when it's the one thing asked for. */
export function pickNote(query: string, id: string): string | null {
  const asset = holds[id];
  if (!asset || !query.trim()) return null;
  const m = predict(query, asset);
  return m.answer === "several" ? `${m.count} to pick from` : null;
}

/** The asset's file holds what was searched for, by name. */
export const holdsNamed = (query: string, id: string) => Boolean(holds[id] && names(query, holds[id]));
