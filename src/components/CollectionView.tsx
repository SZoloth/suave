import { Check, LayoutGrid, List, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Asset, api, thumb } from "../api";
import type { LocalCollection } from "../lib/collections";
import { timeAgo } from "../lib/recent";
import { when } from "../plan";
import { addLabel } from "./GroupBar";
import { Pressable } from "./Pressable";
import { TextMorph } from "./TextMorph";

type Props = {
  collection: LocalCollection;
  cartIds: Set<string>;
  onAdd: (assets: Asset[]) => void;
  onToggleCart: (a: Asset) => void;
  onOpen: (a: Asset) => void;
  /** In a split column: the column header already names it. */
  inPane?: boolean;
};

const SORTS = {
  kept: { label: "As kept", by: null },
  name: { label: "Name", by: (a: Asset, b: Asset) => a.name.localeCompare(b.name) },
  changed: { label: "Recently changed", by: (a: Asset, b: Asset) => (b.lastModifiedAt ?? "").localeCompare(a.lastModifiedAt ?? "") },
  author: { label: "Made by", by: (a: Asset, b: Asset) => (a.author ?? "").localeCompare(b.author ?? "") },
} as const;
type SortKey = keyof typeof SORTS;
const CATEGORIES_SHOWN = 6;

function Cover({ assets }: { assets: Asset[] }) {
  const four = assets.slice(0, 4);
  return (
    <span className="grid size-12 shrink-0 grid-cols-2 gap-px overflow-hidden rounded-[11px] bg-[var(--hairline)] ring-1 ring-[var(--hairline)]" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="bg-[var(--raised)]">
          {four[i] && <img src={thumb(four[i].id)} alt="" className="h-full w-full object-contain p-px" />}
        </span>
      ))}
    </span>
  );
}

/** A saved collection in the canvas. Fixed: it shows what was kept, and never reruns. */
export function CollectionView({ collection: c, cartIds, onAdd, onToggleCart, onOpen, inPane = false }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("kept");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [goesWith, setGoesWith] = useState<Asset[]>([]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of c.assets) for (const cat of a.categories) counts.set(cat, (counts.get(cat) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, CATEGORIES_SHOWN);
  }, [c.assets]);
  const shown = useMemo(() => {
    const kept = category ? c.assets.filter((a) => a.categories.includes(category)) : c.assets;
    const by = SORTS[sort].by;
    return by ? [...kept].sort(by) : kept;
  }, [c.assets, category, sort]);
  const makers = new Set(c.assets.map((a) => a.author).filter(Boolean)).size;
  const add = addLabel(shown, cartIds);

  useEffect(() => {
    if (c.assets.length === 0) return;
    let live = true;
    const ids = new Set(c.assets.map((a) => a.id));
    api
      .complements(c.assets.slice(0, 12).map((a) => a.id), 8)
      .then((r) => live && setGoesWith(r.results.filter((a) => !ids.has(a.id))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [c.assets]);

  const chip = (active: boolean) =>
    `pressable inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] ring-1 ${active ? "bg-[var(--accent)] text-[var(--on-accent)] ring-transparent" : "bg-[var(--surface)] text-[var(--text-secondary)] ring-[var(--hairline-strong)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"}`;

  return (
    <div className={inPane ? "px-3 pb-4" : ""}>
    <article aria-label={c.name}>
      {!inPane && (
        <header className="flex items-center gap-3.5">
          <Cover assets={c.assets} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[26px] leading-tight font-semibold tracking-[-0.025em] text-[var(--text)]">{c.name}</h1>
            <p className="mt-0.5 text-[12.5px] text-[var(--text-tertiary)] tabular-nums">
              {c.assets.length} {c.assets.length === 1 ? "asset" : "assets"}
              {makers > 0 && ` · by ${makers} ${makers === 1 ? "artist" : "artists"}`} · {c.sample ? "in Library" : c.discoverable ? "visible to others" : "only you"} · changed {timeAgo(c.updatedAt)}
            </p>
          </div>
          {shown.length > 0 && (
            <Pressable
              onClick={() => onAdd(add.adds)}
              disabled={add.adds.length === 0}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${add.adds.length === 0 ? "bg-[var(--ink)]/[0.07] text-[var(--text)]" : "bg-[var(--accent)] text-[var(--on-accent)]"}`}
            >
              <TextMorph text={add.label} />
            </Pressable>
          )}
        </header>
      )}

      <div className={`flex items-center gap-2 ${inPane ? "" : "mt-4"}`}>
        <div role="tablist" aria-label="Category" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <button type="button" role="tab" aria-selected={category === null} onClick={() => setCategory(null)} className={chip(category === null)}>
            All <span className="text-[11px] tabular-nums opacity-60">{c.assets.length}</span>
          </button>
          {categories.length > 1 &&
            categories.map(([cat, n]) => (
              <button key={cat} type="button" role="tab" aria-selected={category === cat} onClick={() => setCategory(category === cat ? null : cat)} className={chip(category === cat)}>
                {cat} <span className="text-[11px] tabular-nums opacity-60">{n}</span>
              </button>
            ))}
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
          <span className="sr-only">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-7 rounded-full bg-[var(--surface)] px-2.5 text-[12.5px] text-[var(--text-secondary)] ring-1 ring-[var(--hairline-strong)] outline-none">
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div role="radiogroup" aria-label="Layout" className="flex shrink-0 rounded-full bg-[var(--ink)]/[0.05] p-0.5">
          {(
            [
              ["grid", LayoutGrid, "Grid"],
              ["list", List, "List"],
            ] as const
          ).map(([k, Icon, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={layout === k}
              aria-label={label}
              title={label}
              onClick={() => setLayout(k)}
              className={`flex size-6 items-center justify-center rounded-full ${layout === k ? "bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-[var(--text-tertiary)]"}`}
            >
              <Icon className="size-3.5" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {layout === "grid" ? (
        <ul className={`mt-3 grid gap-2 ${inPane ? "grid-cols-[repeat(auto-fill,minmax(104px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]"}`}>
          {shown.map((a) => (
            <li key={a.id} className="group/tile relative">
              <Pressable onClick={() => onOpen(a)} aria-label={`Open ${a.name}`} title={a.name} className="hover-lift block w-full">
                <span className="relative block aspect-square overflow-hidden rounded-[12px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]">
                  <img src={thumb(a.id)} alt="" className="h-full w-full object-contain p-1.5" />
                </span>
                <span className="mt-1.5 block truncate text-left text-[12px] text-[var(--text-secondary)]">{a.name}</span>
              </Pressable>
              <CartToggle asset={a} inCart={cartIds.has(a.id)} onToggle={onToggleCart} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-[14px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]">
          {shown.map((a) => (
            <li key={a.id} className="group/tile relative border-t border-[var(--hairline)] first:border-t-0">
              <button type="button" onClick={() => onOpen(a)} className="flex w-full items-center gap-3 py-2 pr-12 pl-2.5 text-left [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.025]">
                <img src={thumb(a.id)} alt="" className="size-10 shrink-0 rounded-[9px] bg-[var(--raised)] object-contain p-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--text)]">{a.name}</span>
                  <span className="block truncate text-[11.5px] text-[var(--text-tertiary)]">
                    {[a.categories[0], a.author, a.lastModifiedAt && `changed ${when(a.lastModifiedAt)}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
              <CartToggle asset={a} inCart={cartIds.has(a.id)} onToggle={onToggleCart} row />
            </li>
          ))}
        </ul>
      )}
      {shown.length === 0 && <p className="mt-6 text-[13px] text-[var(--text-tertiary)]">Nothing in this collection yet.</p>}
    </article>

      {goesWith.length > 0 && (
        <section aria-label="Goes with this collection" className="mt-7">
          <h2 className="text-[13px] font-medium text-[var(--text)]">
            Goes with this collection <span className="font-normal text-[var(--text-tertiary)]">· from the rest of the library</span>
          </h2>
          <ul className={`mt-2.5 grid gap-2 ${inPane ? "grid-cols-4" : "grid-cols-4 sm:grid-cols-8"}`}>
            {goesWith.map((a) => (
              <li key={a.id} className="group/tile relative">
                <Pressable onClick={() => onOpen(a)} aria-label={`Open ${a.name}`} title={a.name} className="hover-lift block aspect-square w-full overflow-hidden rounded-[12px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]">
                  <img src={thumb(a.id)} alt="" className="h-full w-full object-contain p-1" />
                </Pressable>
                <CartToggle asset={a} inCart={cartIds.has(a.id)} onToggle={onToggleCart} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CartToggle({ asset, inCart, onToggle, row = false }: { asset: Asset; inCart: boolean; onToggle: (a: Asset) => void; row?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(asset)}
      aria-pressed={inCart}
      aria-label={inCart ? `Unpin ${asset.name}` : `Pin ${asset.name}`}
      className={`absolute flex size-6 items-center justify-center rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.12)] ${row ? "top-1/2 right-3 -translate-y-1/2" : "top-1.5 right-1.5"} ${
        inCart ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface)] text-[var(--text)] opacity-0 ring-1 ring-[var(--hairline-strong)] group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100"
      }`}
    >
      {inCart ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
    </button>
  );
}
