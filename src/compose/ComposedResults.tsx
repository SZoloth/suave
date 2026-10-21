import "./no-devtools";
import { createLibrary, defineComponent, Renderer, type Library } from "@openuidev/react-lang";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { Asset } from "../api";
import type { SceneRow } from "../scene";
import { AssetCard } from "../components/AssetCard";
import { type CardActions, LineupView } from "../components/views";
import { spring, tween } from "../motion";
import { ChevronDown } from "lucide-react";
import { type Composition, type Facet, MORPH_BUDGET_MS, keepParts, settle } from "./program";
import { makeLibrary } from "./schema";
import { type DataFieldKey, FIELDS, type FieldKey, groupAssets } from "../fields";
import { SelectPill, selectCover } from "../components/FilterBar";
import { TextMorph } from "../components/TextMorph";

/** What the model lays out: the best of the set. The rest still show, under the groups. */
const SENT = 40;
/** Fewer than this and a flat grid is already easy to scan. */
const MIN_TO_GROUP = 8;

type Ctx = {
  sent: Asset[];
  members: Asset[];
  claimed: Map<string, string>;
  actions: CardActions;
  caption?: (a: Asset) => string | null;
  /** Asset ids the picked facet values leave on the page; null when none is picked. */
  allowed: Set<string> | null;
  /** Headings were already on screen, as a scene's rows are while they search: don't fade them in again. */
  calm?: boolean;
};
const ComposeCtx = createContext<Ctx>(null as never);

/** Each asset shows once per page: the first part that names it keeps it. Owner-keyed so StrictMode's second render keeps its own. */
function useAssets(numbers: number[]): Asset[] {
  const { sent, claimed, allowed } = useContext(ComposeCtx);
  const owner = useId();
  const out: Asset[] = [];
  for (const n of numbers ?? []) {
    const a = sent[n - 1];
    if (!a || (claimed.get(a.id) ?? owner) !== owner || (allowed && !allowed.has(a.id))) continue;
    claimed.set(a.id, owner);
    out.push(a);
  }
  return out;
}

const enter = { initial: { opacity: 0, y: 6, filter: "blur(4px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: tween.morph };

const rowClass = "flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&>*]:w-[150px] [&>*]:shrink-0 [&>*]:snap-start";
const rowFade = { maskImage: "linear-gradient(to right, black calc(100% - 48px), transparent)" };

/** A horizontal row: artists often work in narrow windows, and dense sets scroll better than they wrap. */
function Row({ assets }: { assets: Asset[] }) {
  const { actions, caption } = useContext(ComposeCtx);
  return (
    <div className={rowClass} style={rowFade}>
      <AnimatePresence mode="popLayout" initial={false}>
        {assets.map((a, i) => (
          <motion.div
            key={a.id}
            layoutId={a.id}
            layout
            transition={{ ...spring.morph, delay: Math.min(i, 8) * 0.018 }}
            exit={{ opacity: 0, scale: 0.96, transition: tween.morphOut }}
          >
            <AssetCard asset={a} inCart={actions.cartIds.has(a.id)} onToggleCart={actions.onToggleCart} onOpen={actions.onOpen} caption={caption?.(a)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** `assets` null: the row's search hasn't landed, so there's no count or Pin all yet. */
function Heading({ title, assets, quiet }: { title: string; assets: Asset[] | null; quiet?: boolean }) {
  const { actions, calm } = useContext(ComposeCtx);
  const unpinned = assets?.filter((a) => !actions.cartIds.has(a.id)) ?? [];
  return (
    <motion.h3 {...(calm ? {} : enter)} className={`group/h relative mb-3 flex items-center gap-3 ${quiet ? "text-[12px]" : "text-[13px]"}`}>
      <span className={`shrink-0 ${quiet ? "text-[var(--text-tertiary)]" : "font-medium text-[var(--text)]"}`}>{title}</span>
      {assets && <span className="text-[var(--text-tertiary)] tabular-nums">{assets.length}</span>}
      <span className="h-px flex-1 bg-[var(--hairline)]" aria-hidden />
      {unpinned.length > 1 && (
        <button
          type="button"
          onClick={() => actions.onAddAll(unpinned)}
          className="pressable absolute right-0 rounded-full bg-[var(--bg)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] opacity-0 transition-opacity duration-150 group-hover/h:opacity-100 hover:bg-[var(--raised)] hover:text-[var(--text)] focus-visible:opacity-100"
        >
          Pin all
        </button>
      )}
    </motion.h3>
  );
}

const library = makeLibrary<Library>(defineComponent as never, createLibrary as never, {
  Results: function Results({ props, renderNode }: { props: { parts?: unknown[] }; renderNode: (n: unknown) => ReactNode }) {
    const ctx = useContext(ComposeCtx);
    const claimed = new Map<string, string>();
    return (
      <ComposeCtx.Provider value={{ ...ctx, claimed }}>
        <div className="space-y-7">
          {renderNode(keepParts((props.parts ?? []) as { props: { assets?: unknown } }[]))}
          <Rest />
        </div>
      </ComposeCtx.Provider>
    );
  },
  Group: function Group({ props }: { props: { title: string; assets: number[] } }) {
    const assets = useAssets(props.assets);
    if (!assets.length) return null;
    return (
      <motion.section layout="position" transition={spring.morph}>
        <Heading title={props.title} assets={assets} />
        <Row assets={assets} />
      </motion.section>
    );
  },
  Lineup: function Lineup({ props }: { props: { title: string; assets: number[] } }) {
    const { actions } = useContext(ComposeCtx);
    const assets = useAssets(props.assets);
    if (!assets.length) return null;
    return (
      <motion.section layout="position" transition={spring.morph}>
        <Heading title={props.title} assets={assets} />
        <motion.div {...enter}>
          <LineupView assets={assets} order="As grouped" actions={actions} />
        </motion.div>
      </motion.section>
    );
  },
  Pick: function Pick({ props }: { props: { asset: number; why: string } }) {
    const { actions } = useContext(ComposeCtx);
    const [asset] = useAssets([props.asset]);
    if (!asset) return null;
    return (
      <motion.section layout="position" transition={spring.morph} className="flex items-center gap-5">
        <motion.div layoutId={asset.id} layout transition={spring.morph} className="w-[200px] shrink-0">
          <AssetCard asset={asset} inCart={actions.cartIds.has(asset.id)} onToggleCart={actions.onToggleCart} onOpen={actions.onOpen} />
        </motion.div>
        <motion.div {...enter} className="min-w-0 space-y-1">
          <div className="text-[12px] text-[var(--text-tertiary)]">Closest match</div>
          <div className="text-[17px] font-medium tracking-[-0.01em] text-[var(--text)]">{asset.name}</div>
          <div className="text-[13px] text-[var(--text-secondary)]">{props.why}</div>
        </motion.div>
      </motion.section>
    );
  },
  Facet: () => null,
  Value: () => null,
});

/** Matches no part took stay on the page: grouping never hides a result. A picked facet value does, and its chip says so. */
function Rest() {
  const { members, claimed, allowed } = useContext(ComposeCtx);
  const rest = members.filter((a) => !claimed.has(a.id) && (!allowed || allowed.has(a.id)));
  if (!rest.length) return null;
  return (
    <section>
      <Heading title="Other matches" assets={rest} quiet />
      <Row assets={rest} />
    </section>
  );
}

/** Card-shaped stand-ins, so a row keeps its height when its matches land. */
function Placeholders() {
  return (
    <div className={rowClass} style={rowFade} aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${i * 90}ms` }}>
          <div className="aspect-square rounded-[12px] bg-[var(--raised)] ring-1 ring-[var(--hairline)]" />
          <div className="mx-1 mt-2.5 h-2.5 w-3/4 rounded bg-[var(--raised)]" />
          <div className="mx-1 mt-2 h-2 w-1/2 rounded bg-[var(--raised)]" />
        </div>
      ))}
    </div>
  );
}

/** A scene's rows as their searches land: titles first, then each row's matches, muted until the review says which belong. */
export function SearchingRows({ rows, actions, caption }: { rows: SceneRow[]; actions: CardActions; caption?: (a: Asset) => string | null }) {
  const shown = new Set<string>();
  const ctx: Ctx = { sent: [], members: [], claimed: new Map(), actions, caption, allowed: null, calm: true };
  return (
    <ComposeCtx.Provider value={ctx}>
      <div className="space-y-7" aria-busy>
        {rows.map((r, i) => {
          const assets = r.assets?.filter((a) => !shown.has(a.id) && shown.add(a.id)) ?? null;
          return (
            <motion.section key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...tween.morph, delay: i * 0.04 }}>
              <Heading title={r.title} assets={assets} />
              {assets ? (
                <div className="opacity-[0.55] saturate-[0.6]">
                  <Row assets={assets} />
                </div>
              ) : (
                <Placeholders />
              )}
            </motion.section>
          );
        })}
      </div>
    </ComposeCtx.Provider>
  );
}

const programs = new Map<string, string>();

/** A catalog field groups in the browser, exactly and at once, written as the same program the model writes. */
function programOf(groups: { title: string; assets: Asset[] }[], sent: Asset[]): string {
  const number = new Map(sent.map((a, i) => [a.id, i + 1]));
  const parts = groups.map((g, i) => `g${i} = Group(${JSON.stringify(g.title)}, [${g.assets.map((a) => number.get(a.id)).join(", ")}])`);
  return [`root = Results([${groups.map((_, i) => `g${i}`).join(", ")}])`, ...parts].join("\n");
}

const isData = (groupBy: FieldKey | null): groupBy is DataFieldKey => groupBy != null && FIELDS[groupBy].kind === "data";

/**
 * Lays out one set once. A quick answer morphs in; a slow one, or one that lands after the artist moved, waits as an offer.
 * A grouping the artist asked for always morphs in: they're waiting for it.
 */
function useComposition(context: string | undefined, sent: Asset[], groupBy: FieldKey | null, given?: string) {
  const local = isData(groupBy) ? programOf(groupAssets(sent, groupBy), sent) : (!groupBy && given) || null;
  const key = context && sent.length >= (groupBy || given ? 2 : MIN_TO_GROUP) ? `${context}\u0000${groupBy ?? ""}\u0000${sent.map((a) => a.id).join(",")}` : null;
  const [state, setState] = useState<{ key: string; composition: Composition } | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (!key || local != null) return;
    const cached = programs.get(key);
    if (cached != null) return setState({ key, composition: settle(cached, false) });
    touched.current = false;
    const shownAt = performance.now();
    const abort = new AbortController();
    fetch("/api/compose", {
      method: "POST",
      signal: abort.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: context, assets: sent, groupBy: groupBy && FIELDS[groupBy].label }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ program: string }>) : { program: "" }))
      .then(({ program }) => {
        programs.set(key, program);
        setState({ key, composition: settle(program, !groupBy && (touched.current || performance.now() - shownAt > MORPH_BUDGET_MS)) });
      })
      .catch(() => {});
    return () => abort.abort();
  }, [key]);

  const composition: Composition =
    key && local != null ? settle(local, false, local === given) : state && state.key === key ? state.composition : { status: "flat" };
  const program = composition.status === "flat" ? "" : composition.program;
  return {
    composition,
    touch: () => (touched.current = true),
    group: () => key && setState({ key, composition: settle(program, false) }),
    ungroup: () => key && setState({ key, composition: settle(program, true) }),
  };
}

type Picked = Record<string, string>;

/** The asset ids every picked value has, leaving one facet out so its own menu can count against the others. */
function allowedBy(facets: Facet[], picked: Picked, sent: Asset[], skip?: string): Set<string> | null {
  let numbers: number[] | null = null;
  for (const f of facets) {
    const v = f.label !== skip && f.values.find((v) => v.label === picked[f.label]);
    if (!v) continue;
    numbers = numbers ? numbers.filter((n) => v.assets.includes(n)) : v.assets;
  }
  return numbers && new Set(numbers.flatMap((n) => (sent[n - 1] ? [sent[n - 1].id] : [])));
}

/** A difference the model saw, filtered here and now: no request, so it answers as fast as a click. */
function FacetChip({ facet, picked, sent, facets, onPick }: { facet: Facet; picked: Picked; sent: Asset[]; facets: Facet[]; onPick: (value: string | null) => void }) {
  const others = allowedBy(facets, picked, sent, facet.label);
  const value = picked[facet.label];
  return (
    <span className="shrink-0 text-[12px]">
      <SelectPill
        active={!!value}
        select={
          <select value={value ?? ""} onChange={(e) => onPick(e.target.value || null)} aria-label={facet.label} className={selectCover}>
            <option value="">Any</option>
            {facet.values.map((v) => {
              const count = v.assets.filter((n) => sent[n - 1] && (!others || others.has(sent[n - 1].id))).length;
              return (
                <option key={v.label} value={v.label} disabled={!count && v.label !== value}>
                  {`${v.label} · ${count}`}
                </option>
              );
            })}
          </select>
        }
      >
        <span className="shrink-0 text-[var(--text-tertiary)]">{facet.label}</span>
        <TextMorph text={value ?? "Any"} className="truncate font-medium" />
        <ChevronDown className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
      </SelectPill>
    </span>
  );
}

const chip =
  "pressable shrink-0 rounded-full bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)] hover:text-[var(--text)] hover:ring-[var(--hairline-strong)]";

type Props = {
  /** The search so far, follow-ups included. Absent while the result is only a preview. */
  context?: string;
  members: Asset[];
  /** Near misses outside the set, kept below the groups as the flat view keeps them. */
  nearby: Asset[];
  actions: CardActions;
  onAsk?: (line: string) => void;
  /** The flat view, shown until a layout lands and whenever none does. */
  children: ReactNode;
  /** A grouping the artist chose; null lets the layout pick from the search. */
  groupBy?: FieldKey | null;
  /** Leaving a chosen grouping clears it where it's kept, not just on this page. */
  onGroupBy?: (groupBy: FieldKey | null) => void;
  caption?: (a: Asset) => string | null;
  /** The matches picked filters leave, so the card's count and Pin all follow them; null when none is picked. */
  onNarrow?: (narrowed: Asset[] | null) => void;
  /** A layout already written for these members, as a scene's sections are; shown at once instead of asking the model. */
  program?: string;
};

export function ComposedResults({ context, members, nearby, actions, onAsk, children, groupBy = null, onGroupBy, caption, onNarrow, program: given }: Props) {
  const sent = isData(groupBy) ? members : members.slice(0, SENT);
  const { composition, touch, group, ungroup } = useComposition(context, sent, groupBy, given);
  const program = composition.status === "flat" ? "" : composition.program;
  const facets = composition.status === "composed" ? composition.facets : [];
  const [picks, setPicks] = useState<{ program: string; picked: Picked }>({ program: "", picked: {} });
  const picked = picks.program === program ? picks.picked : {};
  const pick = (label: string, value: string | null) => {
    const { [label]: _, ...rest } = picked;
    setPicks({ program, picked: value ? { ...rest, [label]: value } : rest });
  };
  const allowed = allowedBy(facets, picked, sent);
  const narrowed = allowed && members.filter((a) => allowed.has(a.id));
  const narrowedKey = narrowed?.map((a) => a.id).join(",") ?? null;
  const report = useRef(onNarrow);
  report.current = onNarrow;
  useEffect(() => report.current?.(narrowed), [narrowedKey]);
  useEffect(() => () => report.current?.(null), []);
  const ctx: Ctx = { sent, members, claimed: new Map(), actions, caption, allowed, calm: !!given };
  const next = onAsk && composition.status === "composed" ? composition.next : [];
  const lone = facets.length === 0 && next.length === 0;
  const oneGrid = (
    <button type="button" onClick={groupBy && onGroupBy ? () => onGroupBy(null) : ungroup} className="pressable ml-auto shrink-0 px-2 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text)]">
      One grid
    </button>
  );

  return (
    <div onPointerMove={touch} onWheel={touch}>
      <AnimatePresence initial={false} mode="popLayout">
        {composition.status === "offered" ? (
          <motion.button key="offer" {...enter} exit={{ opacity: 0, transition: tween.fade }} type="button" onClick={group} className={`${chip} mb-4 inline-flex max-w-full items-center gap-2`}>
            <span className="text-[var(--text)]">Group as</span>
            <span className="truncate">{composition.titles.join(" · ")}</span>
          </motion.button>
        ) : composition.status === "composed" && !lone ? (
          <motion.div
            key="next"
            {...enter}
            exit={{ opacity: 0, transition: tween.fade }}
            role="group"
            aria-label="This layout"
            className="mb-4 flex items-center gap-2 overflow-x-auto [scrollbar-width:none]"
          >
            {facets.map((f) => (
              <FacetChip key={f.label} facet={f} picked={picked} sent={sent} facets={facets} onPick={(v) => pick(f.label, v)} />
            ))}
            {facets.length > 0 && next.length > 0 && <span className="h-4 w-px shrink-0 bg-[var(--hairline)]" aria-hidden />}
            {next.map((line) => (
              <button key={line} type="button" onClick={() => onAsk?.(line)} className={chip}>
                {line}
              </button>
            ))}
            {oneGrid}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {composition.status === "composed" ? (
        <ComposeCtx.Provider value={ctx}>
          <Renderer library={library} response={composition.program} isStreaming={false} />
          {nearby.length > 0 && !allowed && (
            <section className="pt-7">
              <Heading title="Might also fit" assets={nearby} quiet />
              <Row assets={nearby} />
            </section>
          )}
          {lone && (
            <div role="group" aria-label="This layout" className="-ml-2 pt-5">
              {oneGrid}
            </div>
          )}
        </ComposeCtx.Provider>
      ) : (
        children
      )}
    </div>
  );
}
