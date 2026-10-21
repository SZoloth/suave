import { Check, GripVertical, Plus, X } from "lucide-react";
import { type DragEvent, type ReactNode, useState } from "react";
import type { Asset } from "../api";
import type { Pane } from "../workspace";
import { Pressable } from "./Pressable";
import { type DragItem, carriesItem, droppedItem } from "./Sidebar";
import { TextMorph } from "./TextMorph";

type Shared = {
  labelOf: (s: Pane) => string;
  /** A pane's assets in the order shown, or null before it has been replayed and for Updates. */
  assetsOf: (p: Pane) => Asset[] | null;
  cartIds: Set<string>;
  onAdd: (assets: Asset[]) => void;
};

const fresh = (assets: Asset[], cartIds: Set<string>) => assets.filter((a) => !cartIds.has(a.id));

/** "Pin all 19", "Pin the other 8" or "All 19 pinned": counts what one click would actually pin. */
export function addLabel(assets: Asset[], cartIds: Set<string>): { label: string; adds: Asset[] } {
  const adds = fresh(assets, cartIds);
  if (adds.length === 0) return { label: `All ${assets.length} pinned`, adds };
  return { label: adds.length === assets.length ? `Pin all ${assets.length}` : `Pin the other ${adds.length}`, adds };
}

const unique = (lists: Asset[][]) => [...new Map(lists.flat().map((a) => [a.id, a])).values()];

type BarProps = Shared & {
  title: string;
  group: Pane[];
  focusedId: string;
  /** Narrow windows can't fit searches side by side, so the group shows as tabs over one search. */
  tabs: boolean;
  onFocus: (s: Pane) => void;
  onDetach: (s: Pane) => void;
};

export function GroupBar({ title, group, focusedId, tabs, labelOf, assetsOf, cartIds, onAdd, onFocus, onDetach }: BarProps) {
  const all = unique(group.map((s) => assetsOf(s) ?? []));
  const total = addLabel(all, cartIds);
  const inCart = all.length - total.adds.length;

  return (
    <div role="group" aria-label="This group" className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[26px] leading-tight font-semibold tracking-[-0.025em] text-[var(--text)]">{title}</h1>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-tertiary)] tabular-nums">
            {all.length} assets{inCart > 0 && ` · ${inCart} pinned`}
          </p>
        </div>
        {all.length > 0 && (
          <Pressable
            onClick={() => onAdd(total.adds)}
            disabled={total.adds.length === 0}
            aria-label={total.label}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${total.adds.length === 0 ? "bg-[var(--ink)]/[0.07] text-[var(--text)]" : "bg-[var(--accent)] text-[var(--on-accent)]"}`}
          >
            <TextMorph text={total.label} />
          </Pressable>
        )}
      </div>
      {tabs && (
      <div role="tablist" aria-label="Searches in this group" className="flex min-w-0 flex-wrap items-center gap-1">
        {group.map((s) => {
          const active = s.id === focusedId;
          const assets = assetsOf(s);
          const adds = assets ? fresh(assets, cartIds) : [];
          const allIn = assets != null && assets.length > 0 && adds.length === 0;
          const label = labelOf(s);
          return (
            <div
              key={s.id}
              className={`group/tab flex h-8 max-w-[260px] items-center gap-1 rounded-[9px] pr-1 pl-3 ${
                active ? "bg-[var(--surface)] ring-1 ring-[var(--hairline-strong)]" : "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.04]"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onFocus(s)}
                className={`flex min-w-0 items-center gap-2 text-[13px] ${active ? "text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
              >
                <span className="truncate">{label}</span>
                {assets && <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">{assets.length}</span>}
                {allIn && <Check className="size-3.5 text-[var(--text-tertiary)]" aria-label="All pinned" />}
              </button>
              {adds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onAdd(adds)}
                  aria-label={`Pin ${adds.length} from ${label}`}
                  className="pressable ml-1 hidden h-6 items-center rounded-full bg-[var(--ink)]/[0.06] px-2 text-[11.5px] font-medium text-[var(--text)] group-hover/tab:flex group-focus-within/tab:flex [@media(hover:none)]:flex"
                >
                  Pin {adds.length}
                </button>
              )}
              <button
                type="button"
                onClick={() => onDetach(s)}
                aria-label={`Take ${label} out of this group`}
                title="Take out of this group"
                className="pressable flex size-6 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.08] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

type FrameProps = {
  name: string;
  count: number | null;
  /** The steps that led here, when there were follow-ups. */
  path: string | null;
  focused: boolean;
  onFocus: () => void;
  adds: Asset[];
  onAdd: (assets: Asset[]) => void;
  onDetach: () => void;
  onDragStart: (e: DragEvent) => void;
  children: ReactNode;
};

/** One column in the split. A click anywhere in it does its own job, then points the prompt at it. */
export function PaneFrame({ name, count, path, focused, onFocus, adds, onAdd, onDetach, onDragStart, children }: FrameProps) {
  return (
    <section
      aria-label={name}
      aria-current={focused ? "true" : undefined}
      onClick={focused ? undefined : onFocus}
      className={`flex h-full flex-col rounded-[14px] bg-[var(--surface)] ring-1 transition-shadow duration-150 ${focused ? "ring-[var(--text)]" : "ring-[var(--hairline-strong)] [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[var(--text-tertiary)]"}`}
    >
      <header draggable onDragStart={onDragStart} className="group/col flex h-10 items-center gap-1.5 pr-2 pl-2 cursor-grab active:cursor-grabbing">
        <GripVertical className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
        <h3 className="truncate text-[14px] font-semibold text-[var(--text)]">{name}</h3>
        {count != null && <span className="shrink-0 text-[12px] text-[var(--text-tertiary)] tabular-nums">{count}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {adds.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdd(adds);
              }}
              aria-label={`Pin ${adds.length} from ${name}`}
              className="pressable h-6 rounded-full bg-[var(--ink)]/[0.06] px-2 text-[11.5px] font-medium text-[var(--text)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/10"
            >
              Pin {adds.length}
            </button>
          )}
          <DetachButton label={name} onDetach={onDetach} />
        </span>
      </header>
      {path && <p className="-mt-1.5 truncate px-3 pb-1 text-[12px] text-[var(--text-tertiary)]">{path}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/** Closes a pane by taking its search out of the group; it keeps its own row in Today. */
export function DetachButton({ label, onDetach }: { label: string; onDetach: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDetach();
      }}
      aria-label={`Take ${label} out of this group`}
      title="Take out of this group"
      className="pressable flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.08] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

/** The column a new search fills once "+" is chosen. Nothing is added to the group until Enter. */
export function NewSearchSlot({ count, onCancel, children }: { count: number | null; onCancel: () => void; children: ReactNode }) {
  return (
    <section aria-label="New search" aria-current="true" className="flex h-full flex-col rounded-[14px] bg-[var(--surface)] ring-1 ring-[var(--text)]">
      <header className="flex h-10 items-center gap-1.5 pr-2 pl-3">
        <h3 className="truncate text-[14px] font-semibold text-[var(--text)]">New search</h3>
        {count != null && <span className="shrink-0 text-[12px] text-[var(--text-tertiary)] tabular-nums">{count}</span>}
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel new search"
          title="Cancel"
          className="pressable ml-auto flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.08] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/** The last column of the canvas: opens one more search beside by click, or anything from the sidebar by drop. */
export function BesideColumn({ dragging, onDrop, onAdd }: { dragging: boolean; onDrop: (item: DragItem) => void; onAdd?: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!carriesItem(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const item = droppedItem(e);
        setOver(false);
        if (!item) return;
        e.preventDefault();
        onDrop(item);
      }}
      aria-label={dragging ? "Drop to open beside" : undefined}
      title={dragging ? "Drop to open beside" : undefined}
      className={`flex w-11 shrink-0 flex-col items-center justify-center rounded-[14px] border border-dashed transition-[background-color,border-color] duration-200 ease-out ${over ? "border-[var(--text-secondary)] bg-[var(--ink)]/[0.06] text-[var(--text)]" : dragging ? "border-[var(--text-tertiary)] bg-[var(--ink)]/[0.02] text-[var(--text-secondary)]" : "border-[var(--hairline-strong)] text-[var(--text-tertiary)]"}`}
    >
      {dragging || !onAdd ? (
        <Plus className="size-4" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Open another search beside"
          title="Open another search beside"
          className="pressable flex size-full items-center justify-center rounded-[14px] text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.03] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
