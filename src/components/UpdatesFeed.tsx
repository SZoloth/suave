import { Folder, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Asset, thumb } from "../api";
import type { Sort } from "../intent";
import type { LocalCollection } from "../lib/collections";
import { timeAgo } from "../lib/recent";
import { replaySearch } from "../lib/replay";
import { markOpened, type SavedSearch, savedKey } from "../lib/saved";
import { sortAssets } from "../plan";
import { type Replayed, updatesFrom } from "../updates";
import { Pressable } from "./Pressable";

const SEEN_KEY = "suave-updates-seen";
const FIRST_LOOK_DAYS = 7;
const DAY = 86_400_000;

/** `at` is null before the feed has ever been marked seen. */
function loadSeenAt(): number | null {
  const raw = Number(localStorage.getItem(SEEN_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Re-runs every saved search off screen and diffs it against the last look, without counting as one. */
export function useUpdates(saved: SavedSearch[], collections: LocalCollection[], setSort: Sort, onSavedChange: () => void) {
  const [results, setResults] = useState<Map<string, Replayed>>(() => new Map());
  const [markedAt, setMarkedAt] = useState(loadSeenAt);
  const seenAt = markedAt ?? Date.now() - FIRST_LOOK_DAYS * DAY;
  const keys = saved.map((s) => savedKey(s.query, s.lines)).join("\n");

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      for (const s of saved) {
        const steps = await replaySearch(s.query, s.lines, setSort, ctrl.signal).catch(() => null);
        if (ctrl.signal.aborted) return;
        const last = steps?.at(-1);
        if (last) setResults((m) => new Map(m).set(savedKey(s.query, s.lines), { assets: sortAssets(last.routed.set.members, last.sort), at: Date.now() }));
      }
    })();
    return () => ctrl.abort();
    // Seen ids change on every look; only a new or removed saved search needs a re-run.
  }, [keys, setSort]);

  const items = useMemo(() => updatesFrom(saved, results, collections, seenAt), [saved, results, collections, markedAt]);
  const checking = saved.filter((s) => !results.has(savedKey(s.query, s.lines))).length;

  const markAllSeen = () => {
    for (const u of items) if (u.kind === "search") markOpened(u.key, u.assets.map((a) => a.id));
    const now = Date.now();
    localStorage.setItem(SEEN_KEY, String(now));
    setMarkedAt(now);
    onSavedChange();
  };

  return { items, checking, since: markedAt == null ? `in the last ${FIRST_LOOK_DAYS} days` : `since you looked ${timeAgo(markedAt)}`, markAllSeen };
}

type Props = {
  updates: ReturnType<typeof useUpdates>;
  onOpenSaved: (s: SavedSearch) => void;
  onOpenCollection: (c: LocalCollection) => void;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What changed in the searches and collections the artist follows, one quiet row each. Opening a row marks it seen. */
export function HomeFeed({ updates, onOpenSaved, onOpenCollection }: Props) {
  const { items, checking, since, markAllSeen } = updates;
  return (
    <section aria-labelledby="feed-title" className="overflow-hidden rounded-[16px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 id="feed-title" className="text-[13px] font-medium text-[var(--text)]">
          New in your searches
        </h2>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-tertiary)]">{items.length > 0 && since}</span>
        {items.length > 0 && (
          <button type="button" onClick={markAllSeen} className="shrink-0 text-[12px] text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]">
            Mark all seen
          </button>
        )}
      </div>
      <ul>
        {items.map((u) => {
          const [key, name, meta, thumbs, open] =
            u.kind === "search"
              ? [`s:${u.key}`, u.search.label, `${plural(u.fresh.length, "new match", "new matches")} · last opened ${timeAgo(u.search.openedAt)}`, u.fresh, () => onOpenSaved(u.search)]
              : [`c:${u.collection.id}`, u.collection.name, `Changed in Library ${timeAgo(u.at)} · ${plural(u.collection.assets.length, "asset")}`, u.collection.assets, () => onOpenCollection(u.collection)];
          return (
            <li key={key} className="border-t border-[var(--hairline)] first:border-t-0">
              <Pressable onClick={open} className="flex w-full items-center gap-3 px-4 py-2.5 text-left [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.03]">
                <span className="flex size-8 shrink-0 items-center justify-center" aria-hidden>
                  <span className="size-2 rounded-full bg-[var(--accent)]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-[var(--text)]">
                    {u.kind === "collection" && <Folder className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />}
                    <span className="truncate">{name}</span>
                  </span>
                  <span className="block truncate text-[12px] text-[var(--text-tertiary)]">{meta}</span>
                </span>
                <Thumbs assets={thumbs} />
              </Pressable>
            </li>
          );
        })}
        {checking > 0 && (
          <li className="flex items-center gap-2 border-t border-[var(--hairline)] px-4 py-2.5 text-[12.5px] text-[var(--text-tertiary)] first:border-t-0">
            <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Checking {plural(checking, "saved search", "saved searches")}
          </li>
        )}
        {items.length === 0 && checking === 0 && <li className="px-4 pb-3.5 text-[12.5px] text-[var(--text-tertiary)]">Nothing new {since}.</li>}
      </ul>
    </section>
  );
}

function Thumbs({ assets }: { assets: Asset[] }) {
  const more = assets.length - 3;
  return (
    <span className="hidden shrink-0 items-center sm:flex">
      {assets.slice(0, 3).map((a, i) => (
        <img key={a.id} src={thumb(a.id)} alt="" className={`size-9 rounded-[9px] bg-[var(--raised)] object-contain p-0.5 ring-2 ring-[var(--surface)] ${i > 0 ? "-ml-2.5" : ""}`} />
      ))}
      {more > 0 && <span className="ml-1.5 text-[11.5px] text-[var(--text-tertiary)] tabular-nums">+{more}</span>}
    </span>
  );
}
