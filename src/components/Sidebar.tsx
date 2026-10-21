import { Columns2, Folder, House, PanelLeft, Pin, RefreshCw, Ungroup, X } from "lucide-react";
import { type CSSProperties, type DragEvent, type ReactNode, useState } from "react";
import type { LocalCollection } from "../lib/collections";
import { type SavedSearch, savedKey } from "../lib/saved";
import type { Pane } from "../workspace";

/** Anything that can be dragged onto the canvas or onto a Today row: an open pane, a saved search, or a collection. */
export type DragItem = { kind: "pane"; id: string } | { kind: "saved"; key: string } | { kind: "collection"; id: string };

export const PANE_DRAG = "application/x-suave-pane";

export const dragStart = (item: DragItem) => (e: DragEvent) => {
  e.dataTransfer.setData(PANE_DRAG, JSON.stringify(item));
  e.dataTransfer.effectAllowed = "move";
};

export const carriesItem = (e: DragEvent) => e.dataTransfer.types.includes(PANE_DRAG);

export function droppedItem(e: DragEvent): DragItem | null {
  try {
    return JSON.parse(e.dataTransfer.getData(PANE_DRAG)) as DragItem;
  } catch {
    return null;
  }
}

export const NEW_SEARCH_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

type Props = {
  groups: Pane[][];
  focus: string | null;
  saved: SavedSearch[];
  collections: LocalCollection[];
  /** Saved searches with new matches plus changed collections, shown on home; null until counted. */
  updates: number | null;
  home: boolean;
  tab: "search" | "lab" | "check";
  status: string;
  labelOf: (p: Pane) => string;
  /** Null for a search that hasn't been replayed since a reload. */
  countOf: (p: Pane) => number | null;
  /** True when the item can join the focused pane's group. */
  canOpenBeside: (item: DragItem) => boolean;
  onNew: () => void;
  onOpen: (p: Pane) => void;
  /** Puts an item in the group of pane `into`, or beside the focused pane when `into` is null. */
  onPlace: (item: DragItem, into: string | null) => void;
  onDetach: (p: Pane) => void;
  onSeparate: (group: string) => void;
  onRemove: (p: Pane) => void;
  onOpenSaved: (s: SavedSearch) => void;
  onOpenCollection: (c: LocalCollection) => void;
  onTab: (tab: "lab" | "check") => void;
  /** Absent where the sidebar can't collapse. */
  onCollapse?: () => void;
};

type SavedItem = { kind: "search"; at: number; search: SavedSearch } | { kind: "collection"; at: number; collection: LocalCollection };
const SAVED_SHOWN = 6;

/** Hover buttons sit over the row's right edge, so the label gives up their width while they show. */
const holdFor = (actions: number) => ({ "--hold": `${actions * 26 + 6}px` }) as CSSProperties;
const HOLD = "group-hover/row:pr-[var(--hold)] group-focus-within/row:pr-[var(--hold)]";

const rowClass = (active: boolean, over = false) =>
  `relative flex h-8 w-full items-center gap-2.5 rounded-[8px] pr-1.5 pl-2.5 text-left text-[13px] ${
    over
      ? "bg-[var(--ink)]/[0.07] text-[var(--text)] outline-1 outline-dashed outline-[var(--text-secondary)]"
      : active
        ? "bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-[var(--hairline)]"
        : "text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.04] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
  }`;

const Label = ({ children }: { children: string }) => (
  <h2 className="px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.05em] text-[var(--text-tertiary)] uppercase">{children}</h2>
);

const Count = ({ n }: { n: number | string | null }) => (n == null ? null : <span className="shrink-0 text-[11px] text-[var(--text-tertiary)] tabular-nums">{n}</span>);

const Dot = () => (
  <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
    <span className="size-[5px] rounded-full bg-[var(--text-tertiary)]" />
  </span>
);

const PaneIcon = ({ p }: { p: Pane }) =>
  p.kind === "collection" ? (
    <Folder className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
  ) : p.kind === "pinned" ? (
    <Pin className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
  ) : (
    <Dot />
  );

const itemOf = (p: Pane): DragItem => ({ kind: "pane", id: p.id });

/** Makes a row a drop target that puts the dragged item in the row's group. Stops the drop reaching the sidebar, which would take it out instead. */
function useDropInto(onPlace: Props["onPlace"]) {
  const [over, setOver] = useState<string | null>(null);
  const target = (into: Pane) => ({
    onDragOver: (e: DragEvent) => {
      if (!carriesItem(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(into.group);
    },
    onDragLeave: () => setOver((g) => (g === into.group ? null : g)),
    onDrop: (e: DragEvent) => {
      const item = droppedItem(e);
      setOver(null);
      if (!item || (item.kind === "pane" && item.id === into.id)) return;
      e.preventDefault();
      e.stopPropagation();
      onPlace(item, into.id);
    },
  });
  return { over, target };
}

export function Sidebar(props: Props) {
  const { groups, focus, saved, collections, labelOf, countOf } = props;
  const [allSaved, setAllSaved] = useState(false);
  const { over, target } = useDropInto(props.onPlace);

  const items: SavedItem[] = [
    ...saved.map((s) => ({ kind: "search" as const, at: s.openedAt, search: s })),
    ...collections.map((c) => ({ kind: "collection" as const, at: c.updatedAt, collection: c })),
  ].sort((a, b) => b.at - a.at);

  /** A saved item open on its own is listed once, on its Saved row; side by side it stays in its group too. */
  const alone = groups.filter((g) => g.length === 1).map(([p]) => p);
  const openAlone = (item: SavedItem): Pane | undefined =>
    alone.find((p) =>
      item.kind === "collection"
        ? p.kind === "collection" && p.collectionId === item.collection.id
        : p.kind === "search" && savedKey(p.query, p.lines) === savedKey(item.search.query, item.search.lines),
    );
  const owned = new Set(items.flatMap((item) => openAlone(item)?.id ?? []));
  const today = groups.filter((g) => !(g.length === 1 && owned.has(g[0].id)));
  const shown = allSaved ? items : items.filter((item, i) => i < SAVED_SHOWN || openAlone(item));

  const beside = (item: DragItem) => (props.canOpenBeside(item) ? 1 : 0);
  const besideButton = (item: DragItem, label: string) =>
    props.canOpenBeside(item) && (
      <IconButton label={`Open ${label} beside`} onClick={() => props.onPlace(item, null)}>
        <Columns2 className="size-3.5" aria-hidden />
      </IconButton>
    );

  const paneRow = (p: Pane, child: boolean) => {
    const label = labelOf(p);
    return (
      <li key={p.id} className={`group/row relative ${child ? "pl-4" : ""}`} draggable onDragStart={dragStart(itemOf(p))} {...(child ? {} : target(p))}>
        <button type="button" onClick={() => props.onOpen(p)} aria-current={p.id === focus ? "page" : undefined} title={label} style={holdFor(child ? 1 : 1 + beside(itemOf(p)))} className={`${rowClass(p.id === focus, !child && over === p.group)} ${HOLD}`}>
          <PaneIcon p={p} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="group-hover/row:hidden group-focus-within/row:hidden">
            <Count n={countOf(p)} />
          </span>
        </button>
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          {!child && besideButton(itemOf(p), label)}
          {child ? (
            <IconButton label={`Take ${label} out of this group`} onClick={() => props.onDetach(p)}>
              <X className="size-3.5" aria-hidden />
            </IconButton>
          ) : (
            <IconButton label={`Close ${label}`} onClick={() => props.onRemove(p)}>
              <X className="size-3.5" aria-hidden />
            </IconButton>
          )}
        </span>
      </li>
    );
  };

  return (
    <nav
      aria-label="Searches"
      onDragOver={(e) => carriesItem(e) && e.preventDefault()}
      onDrop={(e) => {
        const item = droppedItem(e);
        const hit = item?.kind === "pane" && groups.flat().find((p) => p.id === item.id);
        if (hit) props.onDetach(hit);
      }}
      className="flex h-full w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-[var(--hairline)] bg-[var(--sidebar)] px-2.5 pt-3.5 pb-3"
    >
      <div className="flex h-6 items-center gap-2 px-1.5">
        <span className="size-[18px] rounded-[5px] bg-[var(--text)]" aria-hidden />
        <span className="flex-1 text-[14px] font-semibold tracking-tight">
          Suave <span className="font-normal text-[var(--text-tertiary)]">Modeling</span>
        </span>
        {props.onCollapse && (
          <IconButton label="Collapse sidebar" onClick={props.onCollapse}>
            <PanelLeft className="size-4" aria-hidden />
          </IconButton>
        )}
      </div>

      <button type="button" onClick={props.onNew} aria-current={props.home ? "page" : undefined} title={`New search (${NEW_SEARCH_KEY})`} className={`-mt-2 ${rowClass(props.home)}`}>
        <House className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
        <span className="min-w-0 flex-1">Home</span>
        {props.updates != null && props.updates > 0 && (
          <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10.5px] font-semibold text-[var(--on-accent)] tabular-nums" aria-label={`${props.updates} new`}>
            {props.updates}
          </span>
        )}
      </button>

      {today.length > 0 && (
        <section aria-label="Today">
          <Label>Today</Label>
          <ul className="space-y-px">
            {today.map((group) => {
              if (group.length === 1) return paneRow(group[0], false);
              const [first] = group;
              const label = group.map(labelOf).join(", ");
              const active = group.some((p) => p.id === focus);
              return (
                <li key={first.group} {...target(first)} className={`rounded-[9px] ${over === first.group ? "bg-[var(--ink)]/[0.05] outline-1 outline-dashed outline-[var(--text-secondary)]" : ""}`}>
                  <div className="group/row relative">
                    <button type="button" onClick={() => props.onOpen(group.find((p) => p.id === focus) ?? first)} title={label} style={holdFor(1)} className={`${rowClass(false)} ${HOLD}`}>
                      <Columns2 className={`size-3.5 shrink-0 ${active ? "text-[var(--text)]" : "text-[var(--text-tertiary)]"}`} aria-hidden />
                      <span className={`min-w-0 flex-1 truncate ${active ? "text-[var(--text)]" : ""}`}>Side by side</span>
                      <span className="group-hover/row:hidden group-focus-within/row:hidden">
                        <Count n={group.length} />
                      </span>
                    </button>
                    <span className="absolute top-1/2 right-1 flex -translate-y-1/2 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                      <IconButton label="Separate these" onClick={() => props.onSeparate(first.group)}>
                        <Ungroup className="size-3.5" aria-hidden />
                      </IconButton>
                    </span>
                  </div>
                  <ul className="space-y-px">{group.map((p) => paneRow(p, true))}</ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {items.length > 0 && (
        <section aria-label="Saved">
          <Label>Saved</Label>
          <ul className="space-y-px">
            {shown.map((item) => {
              const open = openAlone(item);
              const row =
                item.kind === "search"
                  ? {
                      key: `s:${savedKey(item.search.query, item.search.lines)}`,
                      drag: { kind: "saved", key: savedKey(item.search.query, item.search.lines) } as DragItem,
                      label: item.search.label,
                      count: item.search.count,
                      title: "Saved search, reruns each time you open it",
                      icon: RefreshCw,
                      onClick: () => props.onOpenSaved(item.search),
                    }
                  : {
                      key: `c:${item.collection.id}`,
                      drag: { kind: "collection", id: item.collection.id } as DragItem,
                      label: item.collection.name,
                      count: item.collection.assets.length,
                      title: item.collection.sample ? "Collection in Library" : "Collection",
                      icon: Folder,
                      onClick: () => props.onOpenCollection(item.collection),
                    };
              const Icon = row.icon;
              const active = open != null && open.id === focus;
              return (
                <li key={row.key} className="group/row relative" draggable onDragStart={dragStart(open ? itemOf(open) : row.drag)}>
                  <button
                    type="button"
                    onClick={open ? () => props.onOpen(open) : row.onClick}
                    aria-current={active ? "page" : undefined}
                    title={row.title}
                    style={holdFor((open ? 1 : 0) + beside(open ? itemOf(open) : row.drag))}
                    className={`${rowClass(active)} ${HOLD}`}
                  >
                    <Icon className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    <span className="group-hover/row:hidden group-focus-within/row:hidden">
                      <Count n={row.count} />
                    </span>
                  </button>
                  <span className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                    {besideButton(open ? itemOf(open) : row.drag, row.label)}
                    {open && (
                      <IconButton label={`Close ${row.label}`} onClick={() => props.onRemove(open)}>
                        <X className="size-3.5" aria-hidden />
                      </IconButton>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {items.length > SAVED_SHOWN && (
            <button
              type="button"
              onClick={() => setAllSaved((v) => !v)}
              aria-expanded={allSaved}
              className="mt-1 px-2.5 py-1 text-[12px] text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
            >
              {allSaved ? "Show fewer" : `Show all ${items.length}`}
            </button>
          )}
        </section>
      )}

      {!import.meta.env.VITE_PUBLIC_DEMO && (
        <footer className="mt-auto flex flex-wrap items-center gap-1 border-t border-[var(--hairline)] px-1 pt-3 text-[12px] whitespace-nowrap">
          {(
            [
              ["lab", "Real queries"],
              ["check", "Checks"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => props.onTab(id)}
              aria-current={props.tab === id ? "page" : undefined}
              className={`rounded-full px-2 py-0.5 ${props.tab === id ? "bg-[var(--ink)]/10 text-[var(--text)]" : "text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"}`}
            >
              {label}
            </button>
          ))}
          <span className="basis-full px-2 pt-1 text-[11px] text-[var(--text-tertiary)]">{props.status}</span>
        </footer>
      )}
    </nav>
  );
}

/** The sidebar folded to a rail: expand, and home with its unseen dot. */
export function SidebarRail({ onExpand, onNew, updates }: { onExpand: () => void; onNew: () => void; updates: number | null }) {
  return (
    <nav aria-label="Searches" className="flex h-full w-12 shrink-0 flex-col items-center gap-1.5 border-r border-[var(--hairline)] bg-[var(--sidebar)] pt-3">
      <IconButton label="Expand sidebar" onClick={onExpand} size="lg">
        <PanelLeft className="size-4" aria-hidden />
      </IconButton>
      <span className="relative">
        <IconButton label={`Home, new search (${NEW_SEARCH_KEY})`} onClick={onNew} size="lg">
          <House className="size-4" aria-hidden />
        </IconButton>
        {updates != null && updates > 0 && <span className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--sidebar)]" aria-label={`${updates} new`} />}
      </span>
    </nav>
  );
}

function IconButton({ label, onClick, children, size = "sm" }: { label: string; onClick: () => void; children: ReactNode; size?: "sm" | "lg" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`pressable flex items-center justify-center rounded-[6px] text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.08] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)] ${size === "lg" ? "size-8 rounded-[8px]" : "size-6"}`}
    >
      {children}
    </button>
  );
}
