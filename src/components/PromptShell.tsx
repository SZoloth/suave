import { Search, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, type RefObject, useRef } from "react";
import type { Intent, Sort, View } from "../intent";
import { spring, tween } from "../motion";
import { effectivePlan } from "../plan";
import { showAsLabel, surfaceFor } from "../surfaces";
import type { Overrides } from "./IntentBar";
import { IntentChipsRow, openChoices } from "./IntentChipsRow";
import { NEW_SEARCH_KEY } from "./Sidebar";

export type Reading = { status: "idle" } | { status: "reading" } | { status: "understood"; intent: Intent };

type Props = {
  query: string;
  onQuery: (q: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  reading: Reading;
  view: View;
  overrides: Overrides;
  onOverride: (o: Overrides) => void;
  setSort: Sort;
  /** `beside` is true for Cmd/Ctrl+Enter, which opens a new search next to the current one. */
  onSubmit: (beside: boolean) => void;
  placeholder?: string;
  /** The search a follow-up line works on, shown when several are open together. */
  target?: string;
  /** Moves the target to the next search in the group; bound to Tab while the line is empty. */
  onNextTarget?: () => void;
  /** Leaves the current thread; offered while the line is empty, for windows too narrow for the sidebar. */
  onLeave?: () => void;
  /** How the line relates to results already on screen. Replaces the plan chips when the line works on those results. */
  followUp?: ReactNode;
  followUpOnly?: boolean;
  /** A passing status under the line, such as the search model still loading. */
  note?: ReactNode;
};

export function EnterHint({ children }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--text-tertiary)]">
      <kbd className="rounded-md px-1.5 font-sans text-[11px] ring-1 ring-[var(--hairline-strong)]">Enter</kbd>
      {children}
    </span>
  );
}

export function PromptShell({
  query,
  onQuery,
  inputRef,
  reading,
  view,
  overrides,
  onOverride,
  setSort,
  onSubmit,
  placeholder = "Describe a prop, a look, or a whole scene",
  followUp,
  followUpOnly = false,
  target,
  onNextTarget,
  onLeave,
  note,
}: Props) {
  const reduce = useReducedMotion();
  const lastIntent = useRef<Intent | null>(null);
  const lastView = useRef<View>(view);
  if (reading.status === "understood") {
    lastIntent.current = reading.intent;
    lastView.current = view;
  }
  if (!query.trim()) lastIntent.current = null;
  const stale = reading.status === "reading";
  const intent = lastIntent.current;
  const shownView = stale ? lastView.current : view;
  const Icon = intent ? surfaceFor(shownView).icon : Search;
  const iconKey = intent ? shownView : "search";
  const plan = effectivePlan(intent, overrides, setSort);
  const choices = intent && !plan.browse ? openChoices({ intent, view: shownView, overrides, viewDecided: plan.set }) : null;

  return (
    <motion.div
      layoutId="search-prompt"
      transition={reduce ? tween.fade : spring.homePrompt}
      className="group/prompt relative w-full overflow-hidden rounded-[20px] bg-[var(--surface)] shadow-[0_1px_0_rgb(255_255_255/0.05)_inset,0_12px_40px_-12px_rgb(0_0_0/0.12)] ring-1 ring-[var(--hairline-strong)] transition-shadow duration-200 focus-within:ring-[var(--accent)]/45"
    >
      <div className={`flex items-center gap-3 px-4 h-12`}>
        <span className="relative flex size-5 shrink-0 items-center justify-center" aria-hidden>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={iconKey}
              initial={{ opacity: 0, transform: reduce ? "scale(1)" : "scale(0.9)", filter: "blur(2px)" }}
              animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
              exit={{ opacity: 0, transform: reduce ? "scale(1)" : "scale(0.9)", filter: "blur(2px)" }}
              transition={tween.morph}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Icon
                className={`size-[18px] transition-[color,opacity] duration-150 ${intent ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"} ${stale ? "opacity-50" : ""}`}
              />
            </motion.span>
          </AnimatePresence>
        </span>
        {target && (
          <span className="max-w-[40%] shrink-0 truncate rounded-[6px] bg-[var(--raised)] px-1.5 py-0.5 text-[12px] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]" title={`Follow-ups work on ${target}`}>
            → {target}
          </span>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit(e.metaKey || e.ctrlKey);
            } else if (e.key === "Tab" && !e.shiftKey && onNextTarget && !query) {
              e.preventDefault();
              onNextTarget();
            }
          }}
          placeholder={placeholder}
          className={`min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-tertiary)] text-[15px]`}
          aria-label="Search assets"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              onQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="pressable flex size-7 items-center justify-center rounded-full text-[var(--text-tertiary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.06] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
          >
            <X className="size-4" />
          </button>
        ) : onLeave ? (
          <button
            type="button"
            onClick={onLeave}
            className="pressable shrink-0 rounded-full px-2.5 py-1 text-[12.5px] text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.06] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
          >
            New search
          </button>
        ) : onNextTarget ? (
          <span className="hidden shrink-0 text-[11px] text-[var(--text-tertiary)] sm:block">
            <kbd className="font-sans">Tab</kbd> next search
          </span>
        ) : (
          <kbd className="hidden shrink-0 rounded-md px-1.5 py-0.5 font-sans text-[11px] text-[var(--text-tertiary)] ring-1 ring-[var(--hairline-strong)] transition-opacity duration-150 group-focus-within/prompt:opacity-0 sm:block">{NEW_SEARCH_KEY}</kbd>
        )}
      </div>

      {note && (
        <p role="status" className="border-t border-[var(--hairline)] px-4 py-2 text-[12px] text-[var(--text-tertiary)] tabular-nums">
          {note}
        </p>
      )}

      <AnimatePresence initial={false}>
        {intent && query.trim() && (followUp || (!followUpOnly && choices)) && (
          <motion.div
            key="strip"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={tween.strip}
          >
            <div
              className={`flex flex-col gap-2.5 border-t border-[var(--hairline)] px-4 py-2.5 transition-opacity duration-150 ${stale ? "pointer-events-none opacity-50" : ""}`}
              aria-busy={stale || undefined}
            >
              {followUp && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">{followUp}</div>}
              {!followUpOnly && choices && (
                <IntentChipsRow intent={intent} view={shownView} overrides={overrides} onOverride={onOverride} showAsLabel={showAsLabel} viewDecided={plan.set} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
