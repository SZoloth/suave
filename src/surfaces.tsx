import {
  GitCompare,
  LayoutGrid,
  Ruler,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { LayoutGroup } from "motion/react";
import { type ReactNode, useState } from "react";
import { type Asset, MATCH_FLOOR, type SearchResult } from "./api";
import { pickNote } from "./holds";
import type { View } from "./intent";
import { applyCount, compareTargets, formatMetres, size } from "./parse";
import { type Routed, searchingRows } from "./routed";
import type { CardActions } from "./components/views";
import { CompareView, LineupView, SimilarView, SingleView } from "./components/views";
import type { Overrides } from "./components/IntentBar";
import { FilterBar, type Keep } from "./components/FilterBar";
import { SaveMenu } from "./components/SaveMenu";
import { TextMorph } from "./components/TextMorph";
import { ComposedResults, SearchingRows } from "./compose/ComposedResults";
import { FIELDS } from "./fields";
import { type EffectivePlan, type FilterKey, SORT, filterPhrase, isFiltered, sortAssets, withoutFilters } from "./plan";

const relaxedLabel = (keys: FilterKey[], plan: EffectivePlan) => keys.map((k) => filterPhrase(k, plan)).join(" and ");

export type RoutedOf<K extends Routed["kind"]> = Extract<Routed, { kind: K }>;

type SurfaceDef<K extends Routed["kind"]> = {
  icon: LucideIcon;
  showAsLabel: string;
  title: (r: RoutedOf<K>, query: string) => string;
  /** `narrowed` is what the layout's picked filters leave on the page; null when none is picked. */
  meta?: (r: RoutedOf<K>, overrides: Overrides, plan: EffectivePlan, narrowed: Asset[] | null) => string;
  primary?: (r: RoutedOf<K>, actions: CardActions, overrides: Overrides, plan: EffectivePlan, narrowed: Asset[] | null) => { label: string; run: () => void; done?: boolean } | null;
  search?: (r: RoutedOf<K>) => SearchResult;
  Body: (p: {
    routed: RoutedOf<K>;
    actions: CardActions;
    overrides: Overrides;
    plan: EffectivePlan;
    compose?: Compose;
    onOverride?: (o: Overrides) => void;
    onNarrow: (narrowed: Asset[] | null) => void;
  }) => ReactNode;
};

/** Lets the default view be laid out in groups: the search so far, and where a suggested follow-up goes. */
export type Compose = { context: string; onAsk: (line: string) => void };

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cleanQuery(query: string): string {
  return (
    query
      .replace(/^(please\s+)?((find|show|get|give)( me)?|i need|i want|looking for|search for)\s+/i, "")
      .replace(/^(some\s+)?(stuff|things|props|assets)\s+(for|from)\s+/i, "")
      .replace(/^(a|an|the|some)\s+/i, "")
      .replace(/[?.!]+$/, "")
      .trim() || query
  );
}

/** Titled by the plan's description of the assets, so sort and filter words stay in the chips. */
const setTitle = (r: RoutedOf<"single"> | RoutedOf<"lineup">) => sentenceCase(cleanQuery(r.about));

function sortedMembers(r: RoutedOf<"single"> | RoutedOf<"lineup">, overrides: Overrides, plan: EffectivePlan) {
  return sortAssets(applyCount(r.set.members, overrides.count), plan.sort);
}

function setMeta(members: Asset[], nearby: Asset[], checked: boolean, plan: EffectivePlan, order?: string): string {
  const parts = [checked ? `${members.length} ${members.length === 1 ? "match" : "matches"}` : `${members.length} assets`];
  if (nearby.length) parts.push(`${nearby.length} might also fit`);
  if (order || plan.sort !== "relevance") parts.push(order ?? SORT[plan.sort].label);
  if (SORT[plan.sort].sample || plan.window !== "any") parts.push("change dates are sample values");
  return parts.join(" · ");
}

/** The lines the artist chose for each card, or what the order is by. */
function cardCaption(plan: EffectivePlan): ((a: Asset) => string | null) | undefined {
  if (!plan.show.length) return SORT[plan.sort].caption;
  return (a) => plan.show.map((k) => { const f = FIELDS[k]; return f.kind === "data" ? f.value(a) : null; }).filter(Boolean).join(" · ") || null;
}

function addAll(assets: Asset[], actions: CardActions) {
  if (assets.length < 2) return null;
  const allIn = assets.every((a) => actions.cartIds.has(a.id));
  return { label: allIn ? "All pinned" : `Pin all ${assets.length}`, run: () => actions.onAddAll(assets), done: allIn };
}

const lineupSort = (plan: EffectivePlan) => (plan.sort === "size_asc" ? "size_asc" : "size_desc");

function addOrRemove(asset: Asset, actions: CardActions) {
  const inCart = actions.cartIds.has(asset.id);
  return { label: inCart ? "Pinned" : "Pin", run: () => actions.onToggleCart(asset), done: inCart };
}

function compareTitle(query: string, items: { label: string; asset: { name: string } | null }[]): string {
  const names =
    items.length >= 2
      ? items.map((i) => i.asset?.name ?? titleCase(i.label)).slice(0, 2)
      : compareTargets(query).map(titleCase).slice(0, 2);
  if (names.length >= 2) return `${names[0]} vs ${names[1]}, to scale`;
  return names[0] ?? titleCase(query);
}

export const SURFACES: { [K in Routed["kind"]]: SurfaceDef<K> } = {
  single: {
    icon: LayoutGrid,
    showAsLabel: "Results",
    title: (r: RoutedOf<"single">) => setTitle(r),
    search: (r: RoutedOf<"single">) => r.result,
    meta: (r: RoutedOf<"single">, overrides: Overrides, plan: EffectivePlan, narrowed: Asset[] | null) => {
      if (searchingRows(r)) return "Checking each row";
      const members = applyCount(r.set.members, overrides.count);
      return narrowed ? `${narrowed.length} of ${members.length} matches` : setMeta(members, r.set.nearby, r.set.checked, plan);
    },
    primary: (r: RoutedOf<"single">, actions: CardActions, overrides: Overrides, plan: EffectivePlan, narrowed: Asset[] | null) =>
      searchingRows(r) ? null : (plan.set && r.set.checked) || r.theme ? addAll(narrowed ?? sortedMembers(r, overrides, plan), actions) : null,
    Body: ({ routed, actions, overrides, plan, compose, onOverride, onNarrow }) => {
      const caption = cardCaption(plan);
      const rows = searchingRows(routed);
      if (rows) return <SearchingRows rows={rows} actions={actions} caption={caption} />;
      const members = sortedMembers(routed, overrides, plan);
      const grid = (
        <SingleView
          semantic={members}
          nearby={routed.set.nearby}
          caption={caption}
          note={(a) => pickNote(cleanQuery(routed.about), a.id)}
          actions={actions}
        />
      );
      const scene = routed.scene?.stage === "settled" ? routed.scene : null;
      const missing = scene?.missing.length ? (
        <p className="pt-6 text-[12px] text-[var(--text-tertiary)]">Not in the library: {scene.missing.join(", ")}</p>
      ) : null;
      /** A chosen order is the artist's layout; only a grouping they asked for may break it up. */
      if (plan.sort !== "relevance" && !plan.groupBy) return <>{grid}{missing}</>;
      return (
        <>
          <ComposedResults
            program={scene?.program || undefined}
            context={compose?.context}
            members={members}
            nearby={routed.set.nearby}
            actions={actions}
            onAsk={compose?.onAsk}
            groupBy={plan.groupBy}
            onGroupBy={onOverride && ((groupBy) => onOverride({ ...overrides, groupBy }))}
            caption={caption}
            onNarrow={onNarrow}
          >
            {grid}
          </ComposedResults>
          {missing}
        </>
      );
    },
  } as SurfaceDef<"single">,
  lineup: {
    icon: Ruler,
    showAsLabel: "Lineup",
    title: (r: RoutedOf<"lineup">) => `${setTitle(r)}, to scale`,
    search: (r: RoutedOf<"lineup">) => r.result,
    meta: (r: RoutedOf<"lineup">, overrides: Overrides, plan: EffectivePlan) =>
      setMeta(applyCount(r.set.members, overrides.count), [], r.set.checked, plan, SORT[lineupSort(plan)].label),
    primary: (r: RoutedOf<"lineup">, actions: CardActions, overrides: Overrides) => addAll(applyCount(r.set.members, overrides.count), actions),
    Body: ({ routed, actions, overrides, plan }) => (
      <LineupView
        assets={sortAssets(applyCount(routed.set.members.length ? routed.set.members : routed.set.nearby, overrides.count), lineupSort(plan))}
        order={SORT[lineupSort(plan)].label}
        actions={actions}
      />
    ),
  } as SurfaceDef<"lineup">,
  compare: {
    icon: GitCompare,
    showAsLabel: "Compare",
    title: (r: RoutedOf<"compare">, query: string) => compareTitle(query, r.items),
    meta: (r: RoutedOf<"compare">) => `${r.items.filter((i) => i.asset).length} matched`,
    primary: (r: RoutedOf<"compare">, actions: CardActions) => {
      const assets = r.items.map((i) => i.asset).filter((a): a is NonNullable<typeof a> => a != null);
      if (assets.length < 2) return null;
      const allIn = assets.every((a) => actions.cartIds.has(a.id));
      return { label: allIn ? "Both pinned" : "Pin both", run: () => actions.onAddAll(assets), done: allIn };
    },
    Body: ({ routed, actions }) => <CompareView items={routed.items} withPerson={false} actions={actions} />,
  } as SurfaceDef<"compare">,
  scale: {
    icon: Ruler,
    showAsLabel: "Scale check",
    title: (r: RoutedOf<"scale">, query: string) => {
      const name = r.items[0]?.asset?.name ?? titleCase(scaleLabel(query));
      return `${name} · scale check`;
    },
    meta: (r: RoutedOf<"scale">) => {
      const dims = r.items[0]?.asset ? size(r.items[0].asset) : null;
      return dims ? `${formatMetres(dims.h)} tall` : "1 asset";
    },
    primary: (r: RoutedOf<"scale">, actions: CardActions) => (r.items[0]?.asset ? addOrRemove(r.items[0].asset, actions) : null),
    Body: ({ routed, actions }) => <CompareView items={routed.items} withPerson actions={actions} />,
  } as SurfaceDef<"scale">,
  similar: {
    icon: Sparkles,
    showAsLabel: "Look-alikes",
    title: (r: RoutedOf<"similar">) => (r.anchor ? `More like ${r.anchor.name}` : "Look-alikes"),
    meta: (r: RoutedOf<"similar">) => `${r.results.length} similar`,
    primary: (r: RoutedOf<"similar">, actions: CardActions) => (r.anchor ? addOrRemove(r.anchor, actions) : null),
    Body: ({ routed, actions }) => <SimilarView anchor={routed.anchor} results={routed.results} actions={actions} />,
  } as SurfaceDef<"similar">,
};

function scaleLabel(q: string): string {
  return q
    .replace(/^(please\s+)?(find|show|get|give)( me)?\s+|^(i need|i want|looking for|search for)\s+/i, "")
    .replace(/\b(how (big|tall|large|small) (is|are)|scale( of)?|size of|dimensions( of)?|next to an? (person|human|man|woman))\b/gi, " ")
    .replace(/^\s*(a|an|the)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

const VIEW_TO_KIND: Partial<Record<View, Routed["kind"]>> = {
  single: "single",
  scene: "single",
  compare: "compare",
  scale: "scale",
  similar: "similar",
  lineup: "lineup",
  none: "single",
};

export function surfaceFor(view: View) {
  return SURFACES[VIEW_TO_KIND[view] ?? "single"];
}

export function showAsLabel(view: View): string {
  return surfaceFor(view).showAsLabel;
}

export type SurfaceLifecycle =
  | { status: "home" }
  | { status: "deciding"; ghost: Routed | null }
  | { status: "ready"; routed: Routed };

type SurfaceCardProps = {
  routed: Routed;
  query: string;
  debounced: string;
  overrides: Overrides;
  /** Absent for a pinned step, which follow-up lines edit instead. */
  onOverride?: (o: Overrides) => void;
  plan: EffectivePlan;
  actions: CardActions;
  ghost?: boolean;
  save?: { saved: boolean; onToggle: () => void; hint: string };
  /** `page` is the full view: a large title on the canvas. `bare` is a split column, whose frame carries the title. */
  chrome?: "card" | "page" | "bare";
  /** Replaces the view's own title, as when a thread of follow-ups is summed up in words. */
  title?: string;
  /** The steps that led here, in place of the view's one-line summary. */
  trail?: ReactNode;
  compose?: Compose;
  keep?: Keep;
  /** A pinned step: only its grouping and card lines can change. */
  lensOnly?: boolean;
};

export function SurfaceCard(props: SurfaceCardProps) {
  const { routed, query, debounced, overrides, onOverride, plan, actions, ghost, save, chrome = "card" } = props;
  const page = chrome === "page";
  const def = SURFACES[routed.kind];
  const Icon = def.icon;
  const title = props.title ?? def.title(routed as never, query);
  const [narrowed, setNarrowed] = useState<Asset[] | null>(null);
  const meta = def.meta?.(routed as never, overrides, plan, narrowed);
  const primary = def.primary?.(routed as never, actions, overrides, plan, narrowed);
  const search = def.search?.(routed as never);
  const set = "set" in routed ? routed.set : null;
  const about = "about" in routed ? routed.about : debounced;
  const themed = routed.kind === "single" && routed.theme;
  const collectable = !!set && set.members.length > 0 && ((set.checked && (plan.set || routed.kind === "lineup")) || themed);

  const body = (
    <def.Body
      routed={routed as never}
      actions={actions}
      overrides={overrides}
      plan={plan}
      compose={ghost ? undefined : props.compose}
      onOverride={onOverride}
      onNarrow={setNarrowed}
    />
  );

  return (
    <article className={`@container ${chrome === "card" ? "overflow-hidden rounded-[16px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]" : ""}`}>
      {chrome !== "bare" && (
      <header className={page ? `flex gap-2 pb-3 ${props.trail ? "items-start" : "items-end"}` : "flex items-center gap-3 border-b border-[var(--hairline)] py-3 pr-3 pl-4"}>
        {!page && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--raised)] ring-1 ring-[var(--hairline)]">
            <Icon className="size-4 text-[var(--text)]" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2
            className={`truncate font-semibold text-[var(--text)] ${page ? "text-[26px] leading-tight tracking-[-0.025em]" : "text-[15px] tracking-[-0.01em]"}`}
          >
            {props.title ? <TextMorph text={title} /> : title}
          </h2>
          {props.trail ? <div className="mt-0.5">{props.trail}</div> : meta && <p className={`truncate text-[var(--text-tertiary)] tabular-nums ${page ? "mt-0.5 text-[12.5px]" : "text-[12px]"}`}>{meta}</p>}
        </div>
        <SaveMenu
          disabled={ghost}
          live={save}
          keep={
            collectable && set
              ? { count: set.members.length, onKeep: () => actions.onCollect(sortAssets(set.members, plan.sort), title.replace(/, to scale$/, "")) }
              : undefined
          }
        />
        {primary && (
          <PressablePrimary disabled={ghost} onClick={primary.run} label={primary.label} done={primary.done} />
        )}
      </header>
      )}
      {chrome === "bare" && props.trail && <div className="px-3 pt-2">{props.trail}</div>}

      {onOverride && set && (
        <div className={page ? "pb-3" : "border-b border-[var(--hairline)] px-4 py-2.5"}>
          <FilterBar plan={plan} overrides={overrides} onOverride={onOverride} assets={[...set.members, ...set.nearby]} sortable={routed.kind !== "lineup"} keep={props.keep} lensOnly={props.lensOnly} />
        </div>
      )}

      {search?.corrected && (
        <p className="border-b border-[var(--hairline)] px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
          Showing results for <span className="font-medium text-[var(--text)]">{search.corrected}</span>.{" "}
          <button type="button" onClick={() => onOverride?.({ ...overrides, exact: true })} className="text-[var(--accent)] hover:underline">
            Search for "{search.query}" instead
          </button>
        </p>
      )}

      {set?.relaxed ? (
        <p className="border-b border-[var(--hairline)] bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700">
          Nothing {relaxedLabel(set.relaxed, plan)} fits "{about}", so these ignore {set.relaxed.length > 1 ? "those filters" : "that filter"}.{" "}
          <button
            type="button"
            onClick={() => onOverride?.(withoutFilters(overrides, set.relaxed))}
            className="text-[var(--accent)] hover:underline"
          >
            Remove {set.relaxed.length > 1 ? "filters" : "filter"}
          </button>
        </p>
      ) : set?.checked && set.members.length === 0 ? (
        <p className="border-b border-[var(--hairline)] bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700">
          Nothing {isFiltered(plan) ? "that passes your filters " : ""}fits "{about}".{" "}
          {isFiltered(plan) ? (
            <button type="button" onClick={() => onOverride?.(withoutFilters(overrides))} className="text-[var(--accent)] hover:underline">
              {props.keep?.kept.length ? "Search without kept filters" : "Clear filters"}
            </button>
          ) : (
            set.nearby.length > 0 && "These are the closest assets."
          )}
        </p>
      ) : (
        !set?.checked &&
        search &&
        (search.semantic[0]?.score ?? 0) < MATCH_FLOOR && (
          <p className="border-b border-[var(--hairline)] bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700">
            Nothing in this library is a close match for "{debounced}". These are the nearest assets.
          </p>
        )
      )}

      <LayoutGroup id={debounced}>
        <div className={page ? "pt-1" : chrome === "bare" ? "p-3 pt-2" : "p-4"}>{body}</div>
      </LayoutGroup>
    </article>
  );
}

function PressablePrimary({ label, onClick, disabled, done }: { label: string; onClick: () => void; disabled?: boolean; done?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`pressable shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40 ${
        done ? "bg-[var(--ink)]/[0.07] text-[var(--text)]" : "bg-[var(--accent)] text-[var(--on-accent)]"
      }`}
    >
      <TextMorph text={label} />
    </button>
  );
}
