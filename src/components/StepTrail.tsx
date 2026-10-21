import { useState } from "react";
import { SORT } from "../plan";
import type { Step } from "../thread";

const OPEN_KEY = "suave:steps-open";

/** What a step did to the one before it: "Smallest first, kept 3 of 12". */
function effect(step: Step, prev: Step | undefined): string | null {
  if (!prev) return null;
  const [n, was] = [step.routed.set.members.length, prev.routed.set.members.length];
  const parts = [
    step.sort !== prev.sort && step.sort !== "relevance" && SORT[step.sort].label,
    step.routed.kind === "lineup" && prev.routed.kind !== "lineup" && "Lined up",
    n < was && `kept ${n} of ${was}`,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : null;
}

const quoted = (s: string) => `\u201c${s}\u201d`;
/** The words as typed: the first step's label is tidied for titles, its query is not. */
const said = (s: Step, i: number) => quoted(i === 0 ? s.query.trim() : s.label);

type Props = { steps: Step[]; onStep: (index: number) => void; dimmed?: boolean };

/** The artist's own lines, verbatim, under a title that says what they add up to. Collapsed to one line until asked. */
export function StepTrail({ steps, onStep, dimmed }: Props) {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === "1");
  const toggle = () => {
    localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    setOpen(!open);
  };
  const last = steps.at(-1)!;
  const [n, first] = [last.routed.set.members.length, steps[0].routed.set.members.length];

  return (
    <div className={`text-[12.5px] transition-opacity duration-150 ${dimmed ? "opacity-50" : ""}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="step-trail"
        className="group/trail flex max-w-full items-center gap-1.5 text-left text-[var(--text-tertiary)]"
      >
        <span className="shrink-0 tabular-nums">{n === first ? `${n} assets` : `${n} of ${first}`}</span>
        {!open && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate text-[var(--text-secondary)]">{said(last, steps.length - 1)}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span className="shrink-0 underline decoration-[var(--hairline-strong)] underline-offset-2 [@media(hover:hover)_and_(pointer:fine)]:group-hover/trail:text-[var(--text)] [@media(hover:hover)_and_(pointer:fine)]:group-hover/trail:decoration-current">
          {open ? "Hide steps" : `Show ${steps.length} steps`}
        </span>
      </button>
      <div
        id="step-trail"
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        inert={!open}
      >
        <ol aria-label="Steps" className="min-h-0 max-w-md overflow-hidden">
          {steps.map((s, i) => {
            const current = i === steps.length - 1;
            const note = effect(s, steps[i - 1]);
            return (
              <li key={`${i}-${s.label}`} className="relative pt-1 first:pt-1.5">
                {!current && <span aria-hidden className="absolute top-[19px] bottom-[-7px] left-[6.5px] w-px bg-[var(--hairline-strong)]" />}
                <button
                  type="button"
                  onClick={() => onStep(i)}
                  disabled={current}
                  aria-current={current ? "step" : undefined}
                  className="group/step grid w-full grid-cols-[14px_1fr_auto] items-center gap-2 rounded-[6px] text-left disabled:cursor-default"
                >
                  <span aria-hidden className={`size-1.5 justify-self-center rounded-full ${current ? "bg-[var(--text)]" : "bg-[var(--text-tertiary)]"}`} />
                  <span className={`truncate ${current ? "font-medium text-[var(--text)]" : "text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:group-hover/step:text-[var(--text)]"}`}>
                    {said(s, i)}
                    {note && <span className="ml-1.5 font-normal text-[var(--text-tertiary)]">{note}</span>}
                  </span>
                  <span className={`tabular-nums ${current ? "text-[var(--text)]" : "text-[var(--text-tertiary)]"}`}>{s.routed.set.members.length}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
