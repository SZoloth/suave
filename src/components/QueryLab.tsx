import { useEffect, useState } from "react";
import { type RealQuery, api } from "../api";
import { ACT_THRESHOLD, type Intent, contenders } from "../intent";
import { showAsLabel } from "../surfaces";

function wouldAsk(i: Intent): string | null {
  if (i.view.confidence < ACT_THRESHOLD && contenders(i.view).filter((v) => v !== "none").length > 1) return "which view";
  if (i.view.value !== "scene" && (i.count.value === "unclear" || contenders(i.count, 0.25).filter((c) => c === "group" || c === "many_separate").length > 1)) return "separate vs grouped";
  if (contenders(i.subject, 0.25).filter((s) => s === "creature" || s === "depiction").length > 1 || (i.animalUnsaid ?? 0) >= 0.5) return "animal vs object";
  return null;
}

function outcome(q: RealQuery): { label: string; tone: string } {
  if (q.importSuccessful) return { label: "Imported", tone: "text-[var(--accent)]" };
  if (q.importClicked) return { label: "Import failed", tone: "text-amber-700" };
  if (q.clickRanks.length) return { label: `Clicked rank ${Math.min(...q.clickRanks)}`, tone: "text-[var(--text-secondary)]" };
  return { label: "No clicks", tone: "text-[var(--text-tertiary)]" };
}

export function QueryLab({ onRun }: { onRun: (q: string) => void }) {
  const [data, setData] = useState<{ jev: boolean; queries: RealQuery[] } | null>(null);
  useEffect(() => {
    api.realQueries().then(setData);
  }, []);
  if (!data) return <p className="p-8 text-[13px] text-[var(--text-tertiary)]">Loading queries…</p>;

  const { queries } = data;
  const byView = new Map<string, number>();
  for (const q of queries) {
    const v = showAsLabel(q.intent.view.value);
    byView.set(v, (byView.get(v) ?? 0) + 1);
  }
  const asks = queries.filter((q) => wouldAsk(q.intent)).length;
  const noClicks = queries.filter((q) => q.clickRanks.length === 0).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--text)]">Logged queries</h2>
        <p className="max-w-2xl text-[13px] text-[var(--text-secondary)]">
          {queries.length} distinct logged searches. {noClicks} have no recorded clicks. Each row shows the view the new search would open, and whether it
          would stop to ask first. Click a row to try it against the sample library.
        </p>
        <p className="text-[12px] text-[var(--text-tertiary)]">Routing: {data.jev ? "Jev" : "keyword rules (these queries stay local)"}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Would ask first" value={`${asks} of ${queries.length}`} />
        {[...byView.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([v, n]) => (
            <Stat key={v} label={`Opens ${v}`} value={String(n)} />
          ))}
      </div>

      <div className="overflow-x-auto rounded-[16px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="text-[11px] tracking-wide text-[var(--text-tertiary)] uppercase">
            <tr className="border-b border-[var(--hairline)]">
              <th className="px-4 py-2 font-medium">Query</th>
              <th className="px-4 py-2 font-medium">What happened</th>
              <th className="px-4 py-2 font-medium">Would open</th>
              <th className="px-4 py-2 font-medium">Would ask</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((q) => {
              const o = outcome(q);
              const ask = wouldAsk(q.intent);
              return (
                <tr key={q.query} onClick={() => onRun(q.query)} className="cursor-pointer border-b border-[var(--hairline)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.03]">
                  <td className="px-4 py-2 text-[var(--text)]">{q.query}</td>
                  <td className={`px-4 py-2 text-[12px] ${o.tone}`}>
                    {o.label}
                    {q.resultCount != null && <span className="text-[var(--text-tertiary)]"> · {q.resultCount >= 1000 ? "1000+" : q.resultCount} results</span>}
                  </td>
                  <td className="px-4 py-2 text-[12px] text-[var(--text-secondary)]">
                    {showAsLabel(q.intent.view.value)}
                    {q.intent.source === "jev" && <span className="text-[var(--text-tertiary)]"> {Math.round(q.intent.view.confidence * 100)}%</span>}
                  </td>
                  <td className="px-4 py-2 text-[12px] text-[var(--text-secondary)]">{ask ?? <span className="text-[var(--text-tertiary)]">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-[var(--surface)] px-4 py-3 ring-1 ring-[var(--hairline)]">
      <div className="text-lg font-semibold tabular-nums text-[var(--text)]">{value}</div>
      <div className="text-[12px] text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}
