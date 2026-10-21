import { Check, RotateCw } from "lucide-react";
import { useState } from "react";
import { type Space, thumb } from "../api";
import {
  type Calibration,
  type Candidate,
  type GradedQuery,
  SET_QUERIES,
  answer,
  proposed,
  review,
  runQuery,
  sweep,
} from "../lib/calibration";
import { useEval } from "../lib/useEval";
import { FIT } from "../plan";
import { Pressable } from "./Pressable";

const BELOW_SHOWN = 12;
const EMPTY: Calibration = { queries: {} };

export function Calibrate({ space }: { space: Space }) {
  const [cal, update] = useEval<Calibration>("membership", EMPTY);
  const [running, setRunning] = useState<Set<string>>(new Set());

  const run = async (queries: string[]) => {
    setRunning(new Set(queries));
    for (const q of queries) {
      try {
        const fresh = await runQuery(q, space);
        update((prev) => {
          const old = prev.queries[q] as GradedQuery | undefined;
          return { queries: { ...prev.queries, [q]: { ...fresh, labels: old?.labels ?? {}, reviewedAt: old?.reviewedAt ?? null } } };
        });
      } finally {
        setRunning((r) => new Set([...r].filter((x) => x !== q)));
      }
    }
  };

  if (!cal) return <p className="p-8 text-[13px] text-[var(--text-tertiary)]">Loading labels…</p>;

  const setQuery = (q: string, g: GradedQuery) => update((prev) => ({ queries: { ...prev.queries, [q]: g } }));
  const s = sweep(cal);
  const unrun = SET_QUERIES.filter((q) => !cal.queries[q]);
  const best = s.labels ? Math.min(...s.rows.map((r) => r.wrong + r.missing)) : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold text-[var(--text)]">Membership check</h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            For each set search, the checker scores the 60 nearest assets. Fit {FIT} and above shows as a match. Click any asset on the wrong side, then mark the search reviewed. The counts
            below come from reviewed searches only.
          </p>
        </div>
        <Pressable
          onClick={() => run(unrun.length ? unrun : SET_QUERIES)}
          disabled={running.size > 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)]/10 px-3 py-1.5 text-[12px] text-[var(--text)] disabled:opacity-50"
        >
          <RotateCw className={`size-3.5 ${running.size ? "animate-spin" : ""}`} aria-hidden />
          {running.size ? `Checking ${running.size}…` : unrun.length ? `Check ${unrun.length} searches` : "Check all again"}
        </Pressable>
      </header>

      <section className="rounded-[16px] bg-[var(--surface)] p-4 ring-1 ring-[var(--hairline)]">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-medium text-[var(--text)]">Mistakes at each cutoff</h3>
          <span className="text-[12px] text-[var(--text-tertiary)]">
            {s.queries} of {SET_QUERIES.length} searches reviewed, {s.labels} assets
          </span>
        </div>
        {s.labels === 0 ? (
          <p className="text-[12px] text-[var(--text-tertiary)]">Review a search to see how many members each cutoff gets wrong or misses.</p>
        ) : (
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {s.rows.map((r) => (
              <div
                key={r.cutoff}
                className={`rounded-[12px] px-2.5 py-2.5 ring-1 sm:px-3 ${r.wrong + r.missing === best ? "bg-[var(--accent)]/10 ring-[var(--accent)]/40" : "ring-[var(--hairline)]"}`}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[15px] font-semibold tabular-nums text-[var(--text)]">{r.cutoff.toFixed(1)}</span>
                  {r.cutoff === FIT && <span className="text-[11px] text-[var(--text-tertiary)]">now</span>}
                </div>
                <div className="mt-0.5 text-[12px] tabular-nums text-[var(--text-secondary)]">
                  <div>{r.wrong} wrong</div>
                  <div>{r.missing} missing</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {SET_QUERIES.map((q) => (
        <QuerySection key={q} query={q} graded={cal.queries[q]} running={running.has(q)} onChange={(g) => setQuery(q, g)} onRun={() => run([q])} />
      ))}
    </div>
  );
}

function QuerySection({
  query,
  graded,
  running,
  onChange,
  onRun,
}: {
  query: string;
  graded?: GradedQuery;
  running: boolean;
  onChange: (g: GradedQuery) => void;
  onRun: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!graded) {
    return (
      <section className="flex items-center justify-between rounded-[16px] bg-[var(--surface)] px-4 py-3 ring-1 ring-[var(--hairline)]">
        <span className="text-[13px] text-[var(--text-secondary)]">{query}</span>
        <span className="text-[12px] text-[var(--text-tertiary)]">{running ? "Checking…" : "Not checked yet"}</span>
      </section>
    );
  }

  const above = graded.candidates.filter(proposed);
  const below = graded.candidates.filter((c) => !proposed(c));
  const changed = graded.candidates.filter((c) => answer(graded, c) !== proposed(c)).length;
  const flip = (c: Candidate) => onChange({ ...graded, labels: { ...graded.labels, [c.id]: !answer(graded, c) } });
  const visibleBelow = showAll ? below : below.slice(0, BELOW_SHOWN);

  return (
    <section className="space-y-3 rounded-[16px] bg-[var(--surface)] p-4 ring-1 ring-[var(--hairline)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-[var(--text)]">{query}</h3>
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Checked as “{graded.about}” · {above.length} shown · {changed ? `${changed} changed by you` : "no changes"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Pressable onClick={onRun} disabled={running} className="rounded-full px-2.5 py-1 text-[12px] text-[var(--text-secondary)] disabled:opacity-50">
            {running ? "Checking…" : "Check again"}
          </Pressable>
          <Pressable
            onClick={() => onChange(graded.reviewedAt ? { ...graded, reviewedAt: null } : review(graded))}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] ${graded.reviewedAt ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "bg-[var(--ink)]/10 text-[var(--text)]"}`}
          >
            {graded.reviewedAt && <Check className="size-3.5" aria-hidden />}
            {graded.reviewedAt ? "Reviewed" : "Mark reviewed"}
          </Pressable>
        </div>
      </div>

      <Group title={`Shown as matches, fit ${FIT} and up`} empty="Nothing passed the cutoff.">
        {above.map((c) => (
          <Tile key={c.id} c={c} on={answer(graded, c)} changed={answer(graded, c) !== proposed(c)} onClick={() => flip(c)} />
        ))}
      </Group>
      <Group title="Below the cutoff" empty="Every candidate passed.">
        {visibleBelow.map((c) => (
          <Tile key={c.id} c={c} on={answer(graded, c)} changed={answer(graded, c) !== proposed(c)} onClick={() => flip(c)} />
        ))}
      </Group>
      {below.length > BELOW_SHOWN && (
        <Pressable onClick={() => setShowAll((v) => !v)} className="text-[12px] text-[var(--text-secondary)]">
          {showAll ? "Show fewer" : `Show all ${below.length} below the cutoff`}
        </Pressable>
      )}
    </section>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-medium tracking-wide text-[var(--text-tertiary)] uppercase">{title}</h4>
      {children.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">{children}</div>
      ) : (
        <p className="text-[12px] text-[var(--text-tertiary)]">{empty}</p>
      )}
    </div>
  );
}

function Tile({ c, on, changed, onClick }: { c: Candidate; on: boolean; changed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={on ? `${c.name} belongs. Click if it doesn't.` : `${c.name} doesn't belong. Click if it does.`}
      className={`group relative rounded-[10px] p-1.5 text-left transition-[opacity,box-shadow] duration-150 ${
        on ? "ring-1 ring-[var(--accent)]/50" : "opacity-45 ring-1 ring-[var(--hairline)] [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-80"
      }`}
    >
      <div className="aspect-square overflow-hidden rounded-[7px] bg-[var(--ink)]/[0.03]">
        <img src={thumb(c.id)} alt="" loading="lazy" className="size-full object-contain" />
      </div>
      <div className="mt-1 truncate text-[11px] text-[var(--text)]">{c.name}</div>
      <div className="flex items-center justify-between text-[11px] tabular-nums text-[var(--text-tertiary)]">
        <span>{c.fit.toFixed(2)}</span>
        {changed && <span className="text-amber-700">changed</span>}
      </div>
      {on && (
        <span className="absolute top-2.5 right-2.5 grid size-4 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)]">
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </span>
      )}
    </button>
  );
}
