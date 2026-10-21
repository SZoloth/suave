import { motion, useReducedMotion } from "motion/react";
import { Pin, PinOff, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { type Asset, api, thumb } from "../api";
import { FACETS, FACET_KEYS, type FacetValue, facetLabel } from "../facets";
import { formatMetres, size } from "../parse";
import { tween } from "../motion";
import { when } from "../plan";
import { versionsOf } from "../versions";
import { Pressable } from "./Pressable";

export const PANEL_WIDTH = 440;

type Props = {
  asset: Asset;
  pinned: boolean;
  onTogglePin: (a: Asset) => void;
  onOpen: (a: Asset) => void;
  onClose: () => void;
};

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const THUMB = 16;

function Versions({ asset, at, onAt }: { asset: Asset; at: number; onAt: (i: number) => void }) {
  const versions = versionsOf(asset);
  const last = versions.length - 1;
  const dated = Boolean(asset.createdAt || asset.lastModifiedAt);
  const tick = (i: number) => {
    const pct = (i / last) * 100;
    return `calc(${pct}% + ${THUMB / 2 - (pct / 100) * THUMB}px)`;
  };
  const v = versions[at];
  return (
    <section aria-label="Version history" className="px-5 pt-4">
      <div className="relative h-8">
        <div className="absolute inset-x-2 top-[7px] h-[2px] rounded-full bg-[var(--ink)]/10" aria-hidden />
        <div className="absolute top-[7px] left-2 h-[2px] rounded-full bg-[var(--text)] transition-[width] duration-200 ease-out" style={{ width: `calc((100% - 16px) * ${at / last})` }} aria-hidden />
        {versions.map((x, i) => (
          <span
            key={x.n}
            aria-hidden
            className={`absolute top-[4px] size-2 -translate-x-1/2 rounded-full ring-2 ring-[var(--surface)] ${i <= at ? "bg-[var(--text)]" : "bg-[var(--ink)]/20"}`}
            style={{ left: tick(i) }}
          />
        ))}
        {versions.map((x, i) => (
          <span key={`l${x.n}`} aria-hidden className={`absolute top-5 -translate-x-1/2 text-[10.5px] tabular-nums ${i === at ? "font-semibold text-[var(--text)]" : "text-[var(--text-tertiary)]"}`} style={{ left: tick(i) }}>
            v{x.n}
          </span>
        ))}
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={at}
          onChange={(e) => onAt(Number(e.target.value))}
          aria-label="Scrub through versions"
          aria-valuetext={`Version ${versions[at].n}, ${versions[at].stage}`}
          className="version-scrub absolute inset-x-0 top-0 h-4 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <div className="mt-2 flex min-h-5 items-baseline gap-2 text-[12px]">
        <p className="min-w-0 flex-1 truncate text-[var(--text-tertiary)]">
          {v.note} · {v.by}
          {dated && ` · ${day(v.at)}`}
        </p>
        {at !== last && (
          <button type="button" onClick={() => onAt(last)} className="shrink-0 font-medium text-[var(--text)] [@media(hover:hover)_and_(pointer:fine)]:hover:underline">
            Back to current
          </button>
        )}
      </div>
    </section>
  );
}

type Row = readonly [string, string];

function Facts({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 text-[12px]">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-[var(--text-tertiary)]">{label}</dt>
          <dd className="text-[var(--text-secondary)]">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Body({ asset, pinned, onTogglePin, onOpen, onClose }: Props) {
  const [similar, setSimilar] = useState<Asset[]>([]);
  const versions = versionsOf(asset);
  const [at, setAt] = useState(versions.length - 1);
  const shownVersion = versions[at];
  const dims = size(asset);
  const shown = FACET_KEYS.filter((k) => asset[k] && facetLabel(k, asset[k] as FacetValue<typeof k>));
  const facets = shown.map((k) => [FACETS[k].label, facetLabel(k, asset[k] as FacetValue<typeof k>)] as const);
  const sample = [...shown.filter((k) => asset.synthetic?.includes(k)).map((k) => FACETS[k].label), ...(asset.synthetic?.includes("lastModifiedBy") ? ["Last Author"] : []), ...(asset.synthetic?.includes("lastModifiedAt") ? ["Last Modified"] : [])];
  const facet = (label: string) => facets.filter(([l]) => l === label);
  const key: Row[] = [
    ...facet("Show"),
    ...facet("Status"),
    ...(dims ? [["Size", `${formatMetres(dims.h)} tall · ${formatMetres(dims.w)} wide`] as Row] : []),
    ...(asset.author ? [["Author", asset.author] as Row] : []),
    ...(asset.lastModifiedAt ? [["Last Modified", when(asset.lastModifiedAt)] as Row] : []),
  ];
  const more: Row[] = [
    ...facets.filter(([l]) => l !== "Show" && l !== "Status"),
    ["Categories", asset.categories.join(", ") || "None"],
    ...(asset.collections.length > 0 ? [["Set", asset.collections.map((c) => c.replaceAll("_", " ")).join(", ")] as Row] : []),
    ["Tags", asset.tags.join(", ")],
    ...(asset.lastModifiedBy ? [["Last Author", asset.lastModifiedBy] as Row] : []),
    ...(asset.createdAt ? [["Created", when(asset.createdAt)] as Row] : []),
  ];

  useEffect(() => {
    let live = true;
    api.similar([asset.id], 8).then((r) => live && setSimilar(r.results));
    return () => {
      live = false;
    };
  }, [asset.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (tag === "INPUT" || tag === "TEXTAREA") {
        return;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setAt((i) => Math.max(0, Math.min(versions.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1))));
      } else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        onTogglePin(asset);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, versions.length, onClose, onTogglePin]);

  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-4">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--text)]">{asset.name}</h2>
        <Pressable onClick={onClose} aria-label="Close details" className="flex size-7 items-center justify-center rounded-full text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.06] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]">
          <X className="size-4" />
        </Pressable>
      </div>
      <div className="relative mx-5 mt-4 aspect-square overflow-hidden rounded-[12px] bg-[var(--raised)]">
        <img src={thumb(asset.id)} alt="" style={{ filter: shownVersion.look }} className="h-full w-full object-contain p-4 transition-[filter] duration-200 ease-out" />
        <span className="absolute top-2.5 left-2.5 rounded-full bg-[var(--surface)]/90 px-2 py-0.5 text-[11px] font-medium text-[var(--text)] tabular-nums shadow-[0_1px_2px_rgb(0_0_0/0.08)] backdrop-blur">
          v{shownVersion.n} · {shownVersion.stage}
        </span>
      </div>
      <Versions asset={asset} at={at} onAt={setAt} />
      <div className="space-y-3 px-5 py-4 text-[13px]">
        <Pressable
          onClick={() => onTogglePin(asset)}
          aria-pressed={pinned}
          title={pinned ? "Unpin (P)" : "Pin to import, compare or collect (P)"}
          className={`flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-[12px] font-semibold ${pinned ? "bg-[var(--ink)]/[0.07] text-[var(--text)]" : "bg-[var(--accent)] text-[var(--on-accent)]"}`}
        >
          {pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
          {pinned ? "Pinned · unpin" : "Pin"}
        </Pressable>
        {asset.description && <p className="line-clamp-3 leading-relaxed text-[var(--text-secondary)]">{asset.description}</p>}
        <Facts rows={key} />
        <details className="group">
          <summary className="cursor-pointer list-none text-[12px] font-medium text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]">
            <span className="group-open:hidden">More details</span>
            <span className="hidden group-open:inline">Fewer details</span>
          </summary>
          <div className="mt-2 space-y-3">
            <Facts rows={more} />
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {new Intl.ListFormat("en", { type: "conjunction" }).format([...sample, "version history"])} are sample values in this demo library.
            </p>
          </div>
        </details>
      </div>
      <section className="px-5 pb-6">
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">Looks similar</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {similar.map((a) => (
            <Pressable
              key={a.id}
              onClick={() => onOpen(a)}
              title={a.name}
              className="aspect-square overflow-hidden rounded-[12px] bg-[var(--raised)] ring-1 ring-[var(--hairline)] [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[var(--hairline-strong)]"
            >
              <img src={thumb(a.id)} alt={a.name} className="h-full w-full object-contain p-1" />
            </Pressable>
          ))}
        </div>
      </section>
    </>
  );
}

/** Wide windows: a column that pushes the canvas over instead of covering it. */
export function AssetPanel(props: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.aside
      aria-label={props.asset.name}
      initial={reduce ? { opacity: 0 } : { width: 0 }}
      animate={reduce ? { opacity: 1 } : { width: PANEL_WIDTH }}
      exit={reduce ? { opacity: 0, transition: tween.fade } : { width: 0, transition: tween.trayExit }}
      transition={reduce ? tween.fade : tween.trayEnter}
      style={reduce ? { width: PANEL_WIDTH } : undefined}
      className="h-full shrink-0 overflow-hidden border-l border-[var(--hairline)] bg-[var(--surface)]"
    >
      <div className="h-full overflow-y-auto" style={{ width: PANEL_WIDTH }}>
        <Body key={props.asset.id} {...props} />
      </div>
    </motion.aside>
  );
}

/** Narrow windows: no room to push, so it rises as a sheet. */
export function AssetSheet(props: Props) {
  const reduce = useReducedMotion();
  const hidden = reduce ? "none" : "translateY(100%)";
  return (
    <>
      <motion.button
        type="button"
        className="fixed inset-0 z-30 cursor-default bg-black/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: tween.trayExit }}
        transition={tween.fade}
        onClick={props.onClose}
        aria-label="Close details"
      />
      <motion.div
        role="dialog"
        aria-label={props.asset.name}
        className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-[16px] bg-[var(--surface)] shadow-[0_-16px_48px_rgb(0_0_0/0.12)] ring-1 ring-[var(--hairline-strong)]"
        initial={{ transform: hidden, opacity: reduce ? 0 : 1 }}
        animate={{ transform: "none", opacity: 1 }}
        exit={{ transform: hidden, opacity: reduce ? 0 : 1, transition: reduce ? tween.fade : tween.trayExit }}
        transition={reduce ? tween.fade : tween.trayEnter}
      >
        <Body key={props.asset.id} {...props} />
      </motion.div>
    </>
  );
}
