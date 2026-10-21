import { ChevronDown, Pin, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { Asset } from "../api";
import { FACETS, FACET_KEYS, type FacetValue, facetLabel } from "../facets";
import { CARD_KEYS, FIELDS, type FieldKey, GROUP_KEYS } from "../fields";
import type { ChipId } from "../kept";
import { SORTS, type Sort, type Window } from "../intent";
import { type EffectivePlan, SORT, withoutFilters } from "../plan";
import { tween } from "../motion";
import type { Overrides } from "./IntentBar";
import { TextMorph } from "./TextMorph";

const WINDOW_LABEL: Record<Exclude<Window, "any">, string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  this_year: "This year",
};

const SORT_LABEL = Object.fromEntries(SORTS.map((s) => [s, SORT[s].label])) as Record<Sort, string>;

/** One filter the bar can show: hidden in "Filter" until set, then a chip. */
type Option = { value: string; label: string; count?: number };
type FilterDef = { id: ChipId; label: string; all: string; value: string | null; options: Option[]; set: (v: string | null) => Overrides };

/** Kept chips read heavier than this-search chips, so a carried-over filter is never a surprise. */
const chipRing = (active: boolean, kept = false) =>
  kept
    ? "bg-[var(--accent)]/22 text-[var(--text)] ring-[var(--accent)]/70"
    : active
      ? "bg-[var(--accent)]/12 text-[var(--text)] ring-[var(--accent)]/35"
      : "text-[var(--text-secondary)] ring-[var(--hairline-strong)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.05]";

export const selectCover = "absolute inset-0 cursor-pointer appearance-none opacity-0";

/** A pill over a transparent native select: the platform menu, keyboard and screen-reader behaviour for free. */
export function SelectPill({ active, kept, children, select, after }: { active: boolean; kept?: boolean; children: ReactNode; select: ReactNode; after?: ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full ring-1 transition-[background-color,box-shadow,color] duration-150 ease-out focus-within:ring-[var(--accent)]/60 ${chipRing(active, kept)}`}
    >
      <label className={`pressable relative inline-flex min-w-0 items-center gap-1 py-1 pl-2.5 ${after ? "pr-0.5" : "pr-1.5"}`}>
        {children}
        {select}
      </label>
      {after}
    </span>
  );
}

/** Keeps a chip for new searches until the tab closes. */
function KeepPin({ kept, label, onKeep }: { kept: boolean; label: string; onKeep: () => void }) {
  return (
    <button
      type="button"
      onClick={onKeep}
      aria-pressed={kept}
      aria-label={kept ? `Stop keeping ${label} for new searches` : `Keep ${label} for new searches`}
      title={kept ? "Kept for new searches" : "Keep for new searches"}
      className={`pressable mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-out ${kept ? "text-[var(--accent)]" : "text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"}`}
    >
      <Pin className={`size-3 ${kept ? "fill-current" : ""}`} aria-hidden />
    </button>
  );
}

export type Keep = { kept: ChipId[]; onKeep: (id: ChipId) => void };

function Chip({
  id,
  label,
  value,
  shown,
  options,
  active,
  onChange,
  keep,
}: {
  id: ChipId;
  label: string;
  value: string;
  shown: string;
  options: Option[];
  active: boolean;
  onChange: (v: string) => void;
  keep?: Keep;
}) {
  const kept = !!keep?.kept.includes(id);
  return (
    <SelectPill
      active={active}
      kept={kept}
      after={keep && active && <KeepPin kept={kept} label={label} onKeep={() => keep.onKeep(id)} />}
      select={
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={selectCover}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {withCount(o)}
            </option>
          ))}
        </select>
      }
    >
      <span className="shrink-0 text-[var(--text-tertiary)]">{label}</span>
      <TextMorph text={shown} className="truncate font-medium" />
      <ChevronDown className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
    </SelectPill>
  );
}

const GROUP_OPTIONS: Option[] = [{ value: "", label: "None" }, ...GROUP_KEYS.map((k) => ({ value: k, label: FIELDS[k].label }))];

/** How results are grouped, and which lines each card carries: the parts of the view that survive pinning. */
function LensChips({ plan, overrides, onOverride, keep }: { plan: EffectivePlan; overrides: Overrides; onOverride: (o: Overrides) => void; keep?: Keep }) {
  const show = plan.show;
  return (
    <>
      <Chip
        id="groupBy"
        label="Group"
        value={plan.groupBy ?? ""}
        shown={plan.groupBy ? FIELDS[plan.groupBy].label : "None"}
        options={GROUP_OPTIONS}
        active={plan.groupBy != null}
        onChange={(v) => onOverride({ ...overrides, groupBy: (v || null) as FieldKey | null })}
        keep={keep}
      />
      <Chip
        id="cards"
        label="Cards"
        value=""
        shown={show.length ? show.map((k) => FIELDS[k].label).join(", ") : "Default"}
        options={[
          { value: "", label: "Lines on each card" },
          ...CARD_KEYS.map((k) => ({ value: k, label: `${show.includes(k) ? "✓ " : "\u2003 "}${FIELDS[k].label}` })),
        ]}
        active={show.length > 0}
        onChange={(v) => v && onOverride({ ...overrides, show: show.includes(v as FieldKey) ? show.filter((k) => k !== v) : [...show, v as FieldKey] })}
        keep={keep}
      />
    </>
  );
}

function tally(assets: Asset[], field: (a: Asset) => string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of assets) for (const v of field(a)) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

const withCount = (o: Option) => (o.count ? `${o.label} · ${o.count}` : o.label);

function filterDefs(plan: EffectivePlan, overrides: Overrides, assets: Asset[]): FilterDef[] {
  const people = [...tally(assets, (a) => a.author?.split(", ") ?? [])].sort((a, b) => b[1] - a[1]);
  const authors: Option[] = people.map(([name, count]) => ({ value: name, label: name, count }));
  if (plan.author && !people.some(([name]) => name === plan.author)) authors.push({ value: plan.author, label: plan.author });
  return [
    {
      id: "window",
      label: "Last Modified",
      all: "Any time",
      value: plan.window === "any" ? null : plan.window,
      options: Object.entries(WINDOW_LABEL).map(([value, label]) => ({ value, label })),
      set: (v) => ({ ...overrides, window: (v ?? "any") as Window }),
    },
    { id: "author", label: "Author", all: "Anyone", value: plan.author, options: authors, set: (v) => ({ ...overrides, author: v }) },
    ...FACET_KEYS.map((key): FilterDef => {
      const counts = tally(assets, (a) => (a[key] ? [a[key]] : []));
      return {
        id: key,
        label: FACETS[key].label,
        all: FACETS[key].all,
        value: plan.facets[key] ?? null,
        options: Object.keys(FACETS[key].values).map((v) => ({ value: v, label: facetLabel(key, v as FacetValue<typeof key>), count: counts.get(v) })),
        set: (v) => ({ ...overrides, facets: { ...overrides.facets, [key]: v } }),
      };
    }),
  ];
}

const enter = { initial: { opacity: 0, scale: 0.94 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.94 }, transition: tween.fade };

/** Sort, plus only the filters that are set. Every other filter waits in one "Filter" menu. Typed words set the same values. */
export function FilterBar({
  plan,
  overrides,
  onOverride,
  assets,
  sortable,
  keep,
  lensOnly,
}: {
  plan: EffectivePlan;
  overrides: Overrides;
  onOverride: (o: Overrides) => void;
  assets: Asset[];
  sortable: boolean;
  /** Absent where a chip can't carry to the next search, as on a pinned step. */
  keep?: Keep;
  /** Only grouping and card lines: a pinned step's set is fixed, its view isn't. */
  lensOnly?: boolean;
}) {
  if (lensOnly) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <LensChips plan={plan} overrides={overrides} onOverride={onOverride} />
      </div>
    );
  }
  const defs = filterDefs(plan, overrides, assets);
  const active = defs.filter((d) => d.value != null);
  const more = defs.filter((d) => d.value == null && d.options.length > 0);
  const narrowed = plan.sort !== "relevance" || active.length > 0 || plan.groupBy != null || plan.show.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      {sortable && (
        <Chip
          id="sort"
          keep={keep}
          label="Sort"
          value={plan.sort}
          shown={SORT_LABEL[plan.sort]}
          options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))}
          active={plan.sort !== "relevance"}
          onChange={(sort) => onOverride({ ...overrides, sort: sort as Sort })}
        />
      )}
      {sortable && <LensChips plan={plan} overrides={overrides} onOverride={onOverride} keep={keep} />}
      <AnimatePresence initial={false} mode="popLayout">
        {active.map((d) => (
          <motion.span key={d.id} {...enter} className="inline-flex max-w-full">
            <Chip
              id={d.id}
              keep={keep}
              label={d.label}
              value={d.value!}
              shown={d.options.find((o) => o.value === d.value)?.label ?? d.value!}
              options={[{ value: "", label: d.all }, ...d.options]}
              active
              onChange={(v) => onOverride(d.set(v || null))}
            />
          </motion.span>
        ))}
      </AnimatePresence>
      {more.length > 0 && (
        <SelectPill
          active={false}
          select={
            <select
              value=""
              onChange={(e) => {
                const at = e.target.value.indexOf(":");
                const def = more.find((d) => d.id === e.target.value.slice(0, at));
                if (def) onOverride(def.set(e.target.value.slice(at + 1)));
              }}
              aria-label="Add a filter"
              className={selectCover}
            >
              <option value="" disabled>
                Add a filter
              </option>
              {more.map((d) => (
                <optgroup key={d.id} label={d.label}>
                  {d.options.map((o) => (
                    <option key={o.value} value={`${d.id}:${o.value}`}>
                      {withCount(o)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          }
        >
          <Plus className="size-3.5 text-[var(--text-tertiary)]" aria-hidden />
          <span className="pr-1">Filter</span>
        </SelectPill>
      )}
      {narrowed ? (
        <button
          type="button"
          onClick={() => onOverride({ ...withoutFilters(overrides), sort: "relevance", groupBy: null, show: [] })}
          className="pressable ml-0.5 rounded-full px-2 py-1 text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
        >
          Clear
        </button>
      ) : (
        <span className="ml-1 hidden text-[var(--text-tertiary)] md:inline">Or type it: "approved, changed this week"</span>
      )}
    </div>
  );
}
