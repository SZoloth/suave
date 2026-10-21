const KEY = "suave-saved";

/**
 * Keeps the words, not the results, so "this week" means the current week every time it runs.
 * `lines` are the follow-ups after the first search ("only the wooden ones"), replayed in order.
 */
export type SavedSearch = { query: string; lines: string[]; label: string; savedAt: number; openedAt: number; seen: string[]; count: number };

export type Freshness = { key: string; fresh: number; since: number };

const norm = (s: string) => s.trim().toLowerCase();
export const savedKey = (query: string, lines: string[]) => [query, ...lines].map(norm).join(" > ");
const keyOf = (s: SavedSearch) => savedKey(s.query, s.lines);

function parse(raw: unknown): SavedSearch | null {
  const s = raw as Partial<SavedSearch> | null;
  if (typeof s?.query !== "string" || typeof s.label !== "string" || !Array.isArray(s.seen)) return null;
  return { ...(s as SavedSearch), lines: Array.isArray(s.lines) ? s.lines.filter((l) => typeof l === "string") : [] };
}

export function loadSaved(): SavedSearch[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.flatMap((r) => parse(r) ?? []) : [];
  } catch {
    return [];
  }
}

const write = (list: SavedSearch[]) => localStorage.setItem(KEY, JSON.stringify(list));

export function toggleSaved(query: string, lines: string[], label: string, ids: string[], now = Date.now()): SavedSearch[] {
  const key = savedKey(query, lines);
  const list = loadSaved();
  const next = list.some((s) => keyOf(s) === key)
    ? list.filter((s) => keyOf(s) !== key)
    : [{ query, lines, label, savedAt: now, openedAt: now, seen: ids, count: ids.length }, ...list];
  write(next);
  return next;
}

/** Counts assets not in the last look, then records this look. */
export function markOpened(key: string, ids: string[], now = Date.now()): Freshness | null {
  const list = loadSaved();
  const hit = list.find((s) => keyOf(s) === key);
  if (!hit) return null;
  const seen = new Set(hit.seen);
  const fresh = ids.filter((id) => !seen.has(id)).length;
  write(list.map((s) => (s === hit ? { ...s, openedAt: now, seen: ids, count: ids.length } : s)));
  return { key, fresh, since: hit.openedAt };
}
