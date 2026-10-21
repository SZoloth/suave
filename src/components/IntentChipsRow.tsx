import type { ReactNode } from "react";
import { ACT_THRESHOLD, type Count, type Intent, type Subject, type View, contenders } from "../intent";
import type { Overrides } from "./IntentBar";

const COUNT_LABEL: Partial<Record<Count, string>> = {
  many_separate: "Separate assets",
  group: "One grouped asset",
};

const SUBJECT_LABEL: Partial<Record<Subject, string>> = {
  creature: "The animal",
  depiction: "An object shaped like one",
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`pressable rounded-full px-2.5 py-1 text-[12px] ${
        active ? "bg-[var(--text)] text-[var(--on-accent)]" : "bg-[var(--ink)]/[0.06] text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/10"
      }`}
    >
      {children}
    </button>
  );
}

type ChoiceInput = {
  intent: Intent;
  view: View;
  overrides: Overrides;
  /** The plan picked the view, so Jev's view doubt doesn't need the artist. */
  viewDecided?: boolean;
};

/** What Jev wasn't sure enough about to decide alone. */
export function openChoices({ intent, view, overrides, viewDecided = false }: ChoiceInput) {
  const ranked = contenders(intent.view).filter((v) => v !== "none" && v !== "scene");
  const views = !viewDecided && intent.view.confidence < ACT_THRESHOLD && ranked.length > 1 ? ranked.slice(0, 3) : overrides.view ? (["single", "lineup"] as View[]) : null;
  const countOptions = contenders(intent.count, 0.25).filter((c) => c in COUNT_LABEL);
  const count = view === "single" && (intent.count.value === "unclear" || countOptions.length > 1);
  const subjectOptions = contenders(intent.subject, 0.25).filter((s) => s in SUBJECT_LABEL);
  const subject = subjectOptions.length > 1 || (intent.animalUnsaid ?? 0) >= 0.5;
  return views || count || subject ? { views, count, subject } : null;
}

export function IntentChipsRow(props: ChoiceInput & { onOverride: (o: Overrides) => void; showAsLabel: (v: View) => string }) {
  const { view, overrides, onOverride, showAsLabel } = props;
  const open = openChoices(props);
  if (!open) return null;
  const { views: viewOptions, count: unsureCount, subject: unsureSubject } = open;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
      {viewOptions && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[var(--text-tertiary)]">Show as</span>
          {viewOptions.map((v) => (
            <Chip
              key={v}
              active={view === v}
              onClick={() => onOverride({ ...overrides, view: v })}
            >
              {showAsLabel(v)}
            </Chip>
          ))}
        </span>
      )}

      {unsureCount && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[var(--text-tertiary)]">Did you mean</span>
          {(["many_separate", "group"] as Count[]).map((c) => (
            <Chip
              key={c}
              active={overrides.count === c}
              onClick={() => onOverride({ ...overrides, count: overrides.count === c ? undefined : c })}
            >
              {COUNT_LABEL[c]}
            </Chip>
          ))}
        </span>
      )}

      {unsureSubject && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[var(--text-tertiary)]">Looking for</span>
          {(["creature", "depiction"] as Subject[]).map((s) => (
            <Chip
              key={s}
              active={overrides.subject === s}
              onClick={() => onOverride({ ...overrides, subject: overrides.subject === s ? undefined : s })}
            >
              {SUBJECT_LABEL[s]}
            </Chip>
          ))}
        </span>
      )}
    </div>
  );
}
