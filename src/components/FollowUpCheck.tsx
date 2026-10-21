import { Check, RotateCw } from "lucide-react";
import { useState } from "react";
import { TURNS, type Turn } from "../intent";
import { type FollowUpSet, SEED, type ScriptedThread, type ThreadLine, runThread, score } from "../lib/followups";
import { useEval } from "../lib/useEval";
import { Pressable } from "./Pressable";

const TURN_LABEL: Record<Turn, string> = { new: "New search", refine: "Refine", act: "Action" };
const nextTurn = (t: Turn) => TURNS[(TURNS.indexOf(t) + 1) % TURNS.length];

export function FollowUpCheck() {
  const [set, update] = useEval<FollowUpSet>("threads", SEED);
  const [running, setRunning] = useState(false);

  if (!set) return <p className="p-8 text-[13px] text-[var(--text-tertiary)]">Loading threads…</p>;

  const runAll = async () => {
    setRunning(true);
    try {
      const read = await Promise.all(set.threads.map(runThread));
      update((prev) => ({
        threads: prev.threads.map((th, i) => ({ ...th, lines: th.lines.map((l, j) => ({ ...l, read: read[i]?.lines[j]?.text === l.text ? read[i].lines[j].read : l.read })) })),
      }));
    } finally {
      setRunning(false);
    }
  };
  const setThread = (i: number, th: ScriptedThread) => update((prev) => ({ threads: prev.threads.map((x, j) => (j === i ? th : x)) }));

  const all = score(set.threads);
  const reviewed = set.threads.filter((th) => th.reviewedAt);
  const sure = score(reviewed);
  const ran = all.lines > 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold text-[var(--text)]">Follow-up check</h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Each thread starts with a library search. Jev reads every later line as a new search, a refine of what's on screen, or an action on it. Click an expected answer to change it,
            then mark the thread reviewed. A new search read as a refine is the costly miss, because the result looks plausible.
          </p>
        </div>
        <Pressable
          onClick={runAll}
          disabled={running}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)]/10 px-3 py-1.5 text-[12px] text-[var(--text)] disabled:opacity-50"
        >
          <RotateCw className={`size-3.5 ${running ? "animate-spin" : ""}`} aria-hidden />
          {running ? "Reading…" : ran ? "Read all again" : `Read ${set.threads.length} threads`}
        </Pressable>
      </header>

      {reviewed.length < set.threads.length && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-[var(--ink)]/[0.03] px-3 py-2 text-[12px] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]">
          <span>
            {set.threads.length - reviewed.length} threads still show proposed answers. If every expected answer looks right, confirm them all at once.
          </span>
          <Pressable
            onClick={() => {
              const now = new Date().toISOString();
              update((prev) => ({ threads: prev.threads.map((th) => ({ ...th, reviewedAt: th.reviewedAt ?? now })) }));
            }}
            className="rounded-full bg-[var(--ink)]/10 px-3 py-1 text-[12px] text-[var(--text)]"
          >
            Mark all reviewed
          </Pressable>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat value={ran ? `${all.right} of ${all.lines}` : "–"} label="Read as expected" />
        <Stat value={ran ? String(all.newAsRefine) : "–"} label="New searches read as refine" warn={all.newAsRefine > 0} />
        <Stat
          value={`${reviewed.length} of ${set.threads.length}`}
          label={sure.lines ? `Threads reviewed, ${sure.right} of ${sure.lines} lines right` : "Threads reviewed"}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {set.threads.map((th, i) => (
          <ThreadCard key={th.lines.map((l) => l.text).join("|")} thread={th} onChange={(next) => setThread(i, next)} />
        ))}
      </div>
    </div>
  );
}

function ThreadCard({ thread, onChange }: { thread: ScriptedThread; onChange: (t: ScriptedThread) => void }) {
  const setLine = (i: number, line: ThreadLine) => onChange({ ...thread, lines: thread.lines.map((l, j) => (j === i ? line : l)) });
  return (
    <section className="rounded-[14px] bg-[var(--surface)] p-3 ring-1 ring-[var(--hairline)]">
      <ol className="space-y-1.5">
        {thread.lines.map((line, i) => (
          <li key={line.text} className="flex items-center gap-2 text-[13px]">
            <span className={`min-w-0 flex-1 truncate ${i === 0 ? "text-[var(--text-secondary)]" : "text-[var(--text)]"}`}>{line.text}</span>
            {i > 0 && (
              <>
                <Pressable
                  onClick={() => setLine(i, { ...line, expected: nextTurn(line.expected) })}
                  title="Expected answer. Click to change."
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]"
                >
                  {TURN_LABEL[line.expected]}
                </Pressable>
                <Read line={line} />
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-2 flex justify-end">
        <Pressable
          onClick={() => onChange({ ...thread, reviewedAt: thread.reviewedAt ? null : new Date().toISOString() })}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${thread.reviewedAt ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"}`}
        >
          {thread.reviewedAt && <Check className="size-3" aria-hidden />}
          {thread.reviewedAt ? "Reviewed" : "Mark reviewed"}
        </Pressable>
      </div>
    </section>
  );
}

function Read({ line }: { line: ThreadLine }) {
  if (!line.read) return <span className="w-24 shrink-0 text-right text-[11px] text-[var(--text-tertiary)]">not read</span>;
  const right = line.read.turn === line.expected;
  const costly = line.expected === "new" && line.read.turn === "refine";
  return (
    <span
      className={`w-24 shrink-0 text-right text-[11px] tabular-nums ${right ? "text-[var(--text-tertiary)]" : costly ? "text-rose-600" : "text-amber-700"}`}
      title={`Jev read this as ${TURN_LABEL[line.read.turn]}, ${Math.round(line.read.confidence * 100)}% sure`}
    >
      {right ? "✓" : TURN_LABEL[line.read.turn]} {Math.round(line.read.confidence * 100)}%
    </span>
  );
}

function Stat({ value, label, warn = false }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className="rounded-[12px] bg-[var(--surface)] px-3 py-2.5 ring-1 ring-[var(--hairline)]">
      <div className={`text-[15px] font-semibold tabular-nums ${warn ? "text-rose-600" : "text-[var(--text)]"}`}>{value}</div>
      <div className="text-[11px] text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}
