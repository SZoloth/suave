import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Asset } from "../api";
import { thumb } from "../api";
import { formatMetres, size } from "../parse";
import { spring } from "../motion";
import { AssetCard } from "./AssetCard";

export type CardActions = {
  cartIds: Set<string>;
  onToggleCart: (a: Asset) => void;
  onAddAll: (a: Asset[]) => void;
  onOpen: (a: Asset) => void;
  onCollect: (assets: Asset[], name: string) => void;
};

function Grid({
  assets,
  actions,
  cols = "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]",
  caption,
  note,
}: {
  assets: Asset[];
  actions: CardActions;
  cols?: string;
  caption?: (a: Asset) => string | null;
  note?: (a: Asset) => string | null;
}) {
  return (
    <div className={`grid gap-3 ${cols}`}>
      {assets.map((a) => (
        <motion.div
          key={a.id}
          layout
          layoutId={a.id}
          initial={false}
          transition={spring.morph}
        >
          <AssetCard asset={a} inCart={actions.cartIds.has(a.id)} onToggleCart={actions.onToggleCart} onOpen={actions.onOpen} caption={caption?.(a)} note={note?.(a)} />
        </motion.div>
      ))}
    </div>
  );
}

export function SingleView({
  semantic,
  nearby = [],
  caption,
  note,
  actions,
}: {
  semantic: Asset[];
  nearby?: Asset[];
  caption?: (a: Asset) => string | null;
  note?: (a: Asset) => string | null;
  actions: CardActions;
}) {
  return (
    <div className="space-y-4">
      <Grid assets={semantic} actions={actions} caption={caption} note={note} />
      {nearby.length > 0 && (
        <section className="pt-2">
          <h3 className="mb-3 flex items-center gap-3 text-[12px] text-[var(--text-tertiary)]">
            <span className="shrink-0">
              Might also fit <span className="tabular-nums">· {nearby.length}</span>
            </span>
            <span className="h-px flex-1 bg-[var(--hairline)]" aria-hidden />
          </h3>
          <Grid assets={nearby} actions={actions} caption={caption} note={note} cols="grid-cols-[repeat(auto-fill,minmax(120px,1fr))]" />
        </section>
      )}
    </div>
  );
}

const PERSON_M = 1.8;

function Person({ height, caption = true }: { height: number; caption?: boolean }) {
  return (
    <figure className="flex shrink-0 flex-col items-center">
      <svg viewBox="0 0 40 100" style={{ height }} className="fill-[var(--text-tertiary)]" aria-label="1.8 m person for scale">
        <circle cx="20" cy="9" r="8" />
        <path d="M8 22h24l-2 38h-4l-1 38h-6l-1-30-1 30h-6l-1-38H10z" />
      </svg>
      {caption && <figcaption className="py-2 text-[11px] whitespace-nowrap text-[var(--text-tertiary)]">Person · 1.80 m</figcaption>}
    </figure>
  );
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const STAGE = 260;
const MAX_STAGE = 560;
/** Zooming to one item, or as far as zoom goes, makes the item this share of the tallest the stage gets. */
const FOCUS_SHARE = 0.6;
const CAPTION_H = 44;
const STAGE_TOP = 48;
const GAP = 12;
const PAD = 48;
const PERSON_W = 0.5;
const MIN_SLOT_M = 0.25;
const LABEL_MIN = 64;
const ROUND = "flex size-7 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)] hover:text-[var(--text)] disabled:opacity-40";

function LineupCaption({ name, height, show }: { name: string; height: number; show: boolean }) {
  return (
    <figcaption className="h-11 w-full pt-2 text-center text-[11px] leading-tight" aria-hidden={!show}>
      {show && (
        <>
          <div className="truncate text-[var(--text)]">{name}</div>
          <div className="text-[var(--text-tertiary)] tabular-nums">{formatMetres(height)}</div>
        </>
      )}
    </figcaption>
  );
}

/**
 * A whole set drawn to real height next to a person, on one floor. Opens zoomed to fit. Zooming in scrolls sideways
 * and goes on until the smallest item is readable; items taller than the stage are cut off at the top.
 */
export function LineupView({ assets, order, actions }: { assets: Asset[]; order: string; actions: CardActions }) {
  const sized = assets.map((a) => ({ asset: a, dims: size(a) })).filter((s): s is { asset: Asset; dims: NonNullable<ReturnType<typeof size>> } => s.dims != null);
  const unsized = assets.length - sized.length;
  const tallest = Math.max(PERSON_M, ...sized.map((s) => s.dims.h));
  const smallest = Math.min(PERSON_M, ...sized.map((s) => s.dims.h));

  const scroller = useRef<HTMLDivElement>(null);
  const width = useWidth(scroller);
  const [zoom, setZoomState] = useState(1);
  const slotM = (w: number) => Math.max(MIN_SLOT_M, w);
  const totalM = PERSON_W + sized.reduce((sum, s) => sum + slotM(s.dims.w), 0);
  const fitPpm = Math.min(STAGE / tallest, width ? (width - PAD - GAP * sized.length) / totalM : Infinity);
  const zoomFor = (h: number) => (FOCUS_SHARE * MAX_STAGE) / (h * fitPpm);
  const maxZoom = Math.max(1, MAX_STAGE / (tallest * fitPpm), zoomFor(smallest));
  const ppm = fitPpm * zoom;
  const px = (m: number) => Math.max(3, m * ppm);
  const stageH = Math.min(tallest * ppm, MAX_STAGE);
  const labels = sized.filter((s) => px(slotM(s.dims.w)) >= LABEL_MIN).length >= sized.length * 0.75;
  const [pointed, setPointed] = useState<{ id: string; name: string; height: number } | null>(null);
  const [pointing, setPointing] = useState(false);
  const ids = assets.map((a) => a.id).sort().join();
  const [shownIds, setShownIds] = useState(ids);
  if (shownIds !== ids) {
    setShownIds(ids);
    setZoomState(1);
    setPointed(null);
  }

  /** After a zoom, scroll so the same spot (or the item zoomed to) sits in the middle. */
  const keep = useRef<{ frac: number } | { id: string } | null>(null);
  const setZoom = (next: number, focus?: string) => {
    const el = scroller.current;
    keep.current = focus ? { id: focus } : el ? { frac: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth } : null;
    setZoomState(Math.min(maxZoom, Math.max(1, next)));
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const k = keep.current;
    keep.current = null;
    if (!el || !k) return;
    if ("frac" in k) el.scrollLeft = k.frac * el.scrollWidth - el.clientWidth / 2;
    else el.querySelector(`[data-id="${CSS.escape(k.id)}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [ppm]);

  const [edges, setEdges] = useState({ left: false, right: false });
  const measureEdges = () => {
    const el = scroller.current;
    if (el) setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(measureEdges, [ppm, width, sized.length]);
  const page = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <div className="space-y-3">
      <div className="relative rounded-[12px] bg-[var(--raised)] ring-1 ring-[var(--hairline)]">
        <div ref={scroller} onScroll={measureEdges} className="overflow-x-auto [scrollbar-width:thin]" tabIndex={0} aria-label="Assets to scale">
          <div className="flex w-max items-end px-6" style={{ columnGap: GAP, height: STAGE_TOP + stageH + CAPTION_H }}>
            <div className="flex shrink-0 flex-col items-center" style={{ width: px(PERSON_W) }}>
              <Person height={px(PERSON_M)} caption={false} />
              <LineupCaption name="Person" height={PERSON_M} show={labels} />
            </div>
            {sized.map(({ asset, dims }) => {
              const slot = px(slotM(dims.w));
              return (
                <figure key={asset.id} data-id={asset.id} className="flex shrink-0 flex-col items-center" style={{ width: slot }}>
                  <button
                    type="button"
                    onClick={() => actions.onOpen(asset)}
                    onPointerEnter={() => {
                      setPointed({ id: asset.id, name: asset.name, height: dims.h });
                      setPointing(true);
                    }}
                    onPointerLeave={() => setPointing(false)}
                    onFocus={() => {
                      setPointed({ id: asset.id, name: asset.name, height: dims.h });
                      setPointing(true);
                    }}
                    onBlur={() => setPointing(false)}
                    className="pressable flex w-full justify-center"
                    aria-label={`Open ${asset.name}, ${formatMetres(dims.h)}`}
                  >
                    <img src={thumb(asset.id)} alt="" style={{ height: px(dims.h) }} className="pointer-events-none w-auto max-w-none object-contain object-bottom" />
                  </button>
                  <LineupCaption name={asset.name} height={dims.h} show={labels} />
                </figure>
              );
            })}
          </div>
        </div>
        <div className="absolute top-3 left-6 flex max-w-[calc(100%-10rem)] items-center gap-2 text-[12px] text-[var(--text-secondary)] tabular-nums">
          {pointed ? (
            <>
              <span className={`truncate transition-opacity duration-150 ${pointing ? "" : "opacity-70"}`}>
                <span className="text-[var(--text)]">{pointed.name}</span> · {formatMetres(pointed.height)}
              </span>
              {Math.abs(zoom - Math.min(maxZoom, Math.max(1, zoomFor(pointed.height)))) > 0.01 && (
                <button
                  type="button"
                  onClick={() => setZoom(zoomFor(pointed.height), pointed.id)}
                  className="shrink-0 rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)] hover:text-[var(--text)]"
                >
                  Zoom to it
                </button>
              )}
            </>
          ) : (
            !labels && <span className="text-[var(--text-tertiary)]">Point at one for its name</span>
          )}
        </div>
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          <button type="button" className={ROUND} onClick={() => setZoom(Math.max(1, zoom / 1.5))} disabled={zoom <= 1} aria-label="Zoom out">
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="h-7 rounded-full bg-[var(--surface)] px-2.5 text-[11px] text-[var(--text-secondary)] tabular-nums ring-1 ring-[var(--hairline)] hover:text-[var(--text)] disabled:opacity-40"
            onClick={() => setZoom(1)}
            disabled={zoom <= 1}
          >
            {zoom <= 1 ? "Fit all" : `${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×`}
          </button>
          <button type="button" className={ROUND} onClick={() => setZoom(Math.min(maxZoom, zoom * 1.5))} disabled={zoom >= maxZoom} aria-label="Zoom in">
            <Plus size={14} />
          </button>
        </div>
        {(["left", "right"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => page(side === "left" ? -1 : 1)}
            aria-label={side === "left" ? "Scroll left" : "Scroll right"}
            tabIndex={edges[side] ? 0 : -1}
            className={`${ROUND} absolute top-1/2 -translate-y-1/2 shadow-lg transition-opacity duration-150 ease-out ${side === "left" ? "left-2" : "right-2"} ${edges[side] ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            {side === "left" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-[var(--text-tertiary)]">
        Drawn to real size, {order.toLowerCase()}.
        {unsized > 0 && ` ${unsized} without dimensions left out.`}
      </p>
    </div>
  );
}

export function CompareView({ items, withPerson, actions }: { items: { label: string; asset: Asset | null }[]; withPerson: boolean; actions: CardActions }) {
  const sized = items.map((i) => ({ ...i, dims: i.asset ? size(i.asset) : null }));
  const tallest = Math.max(withPerson ? PERSON_M : 0, ...sized.map((s) => s.dims?.h ?? 0), 0.01);
  const STAGE = 320;
  const px = (m: number) => Math.max(8, (m / tallest) * STAGE);

  return (
    <div className="space-y-4">
      <div
        className="relative flex items-end justify-center gap-10 rounded-[12px] bg-[var(--raised)] px-8 pt-8 pb-0 ring-1 ring-[var(--hairline)]"
        style={{ minHeight: STAGE + 72 }}
      >
        {withPerson && <Person height={px(PERSON_M)} />}
        {sized.map(({ label, asset, dims }) => (
          <figure key={label} className="flex flex-col items-center">
            {asset && dims ? (
              <button type="button" onClick={() => actions.onOpen(asset)} className="block">
                <img src={thumb(asset.id)} alt={asset.name} style={{ height: px(dims.h) }} className="w-auto object-contain object-bottom" />
              </button>
            ) : (
              <div className="flex h-24 w-32 items-center justify-center rounded border border-dashed border-[var(--hairline-strong)] text-[12px] text-[var(--text-tertiary)]">
                No match
              </div>
            )}
            <figcaption className="py-2 text-center text-[11px] text-[var(--text-secondary)]">
              <div className="text-[var(--text)]">{asset?.name ?? label}</div>
              {dims && (
                <div>
                  {formatMetres(dims.h)} tall · {formatMetres(dims.w)} wide
                </div>
              )}
              <div className="text-[var(--text-tertiary)]">for "{label}"</div>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="text-[12px] text-[var(--text-tertiary)]">Thumbnails are scaled by each asset's real height. Each slot shows the top match for its part of the query.</p>
    </div>
  );
}

export function SimilarView({ anchor, results, actions }: { anchor: Asset | null; results: Asset[]; actions: CardActions }) {
  if (!anchor) return <p className="text-[13px] text-[var(--text-tertiary)]">Couldn't find an asset to start from.</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-[12px] bg-[var(--raised)] p-3 ring-1 ring-[var(--hairline)]">
        <img src={thumb(anchor.id)} alt="" className="h-16 w-16 rounded-[12px] bg-[var(--surface)] object-contain p-1" />
        <div className="text-[13px]">
          <div className="text-[var(--text-tertiary)]">Looks like</div>
          <div className="font-medium text-[var(--text)]">{anchor.name}</div>
        </div>
      </div>
      <Grid assets={results} actions={actions} />
    </div>
  );
}
