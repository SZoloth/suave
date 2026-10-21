import { VIEWS, type View } from "../intent.ts";

const KEY = "suave-recent";
const LIMIT = 5;

export type RecentSearch = { query: string; view: View; thumbIds: string[]; names: string[]; count: number; at: number };

function parse(raw: unknown): RecentSearch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<RecentSearch>;
  if (typeof r.query !== "string" || !Array.isArray(r.thumbIds)) return null;
  return {
    query: r.query,
    view: VIEWS.includes(r.view as View) ? (r.view as View) : "single",
    thumbIds: r.thumbIds.slice(0, 3),
    names: Array.isArray(r.names) ? r.names.slice(0, 3) : [],
    count: typeof r.count === "number" ? r.count : r.thumbIds.length,
    at: typeof r.at === "number" ? r.at : 0,
  };
}

export function loadRecent(): RecentSearch[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(parse).filter((r): r is RecentSearch => r !== null).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(entry: RecentSearch) {
  const q = entry.query.toLowerCase();
  const isDraft = (r: RecentSearch) => q.startsWith(r.query.toLowerCase()) || r.query.toLowerCase().startsWith(q);
  const next = [entry, ...loadRecent().filter((r) => !isDraft(r))].slice(0, LIMIT);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function timeAgo(at: number, now = Date.now()): string {
  if (!at) return "";
  const min = Math.round((now - at) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
