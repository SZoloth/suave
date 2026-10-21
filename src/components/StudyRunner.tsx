import { ArrowRight, Download, FlaskConical, Layers, MessageSquare, RotateCcw, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { STUDY, STUDY_CHANGED, downloadStudy, logStudy, readStudy } from "../lib/study";
import { type Participant, type Screen, screens } from "../lib/study-run";
import schedule from "../lib/study-schedule.json";
import { spring, tween } from "../motion";

type Phase = "brief" | "active" | "pick" | "note";
type RunState = { participant: string; pos: number; phase: Phase; startedAt?: number; saved?: string };

const KEY = "suave-study-run";
const fresh = (participant: string): RunState => ({ participant, pos: 0, phase: "brief" });
const load = (participant: string): RunState => {
  const s: RunState | null = JSON.parse(localStorage.getItem(KEY) ?? "null");
  return s?.participant === participant ? s : fresh(participant);
};
const save = (s: RunState) => localStorage.setItem(KEY, JSON.stringify(s));
const wrongArm = (s: Screen | undefined) => s != null && "arm" in s && s.arm !== STUDY.layout;
const reloadInto = (s: Screen) => {
  if (!("arm" in s)) return;
  const url = new URL(location.href);
  url.searchParams.set("layout", s.arm);
  location.assign(url);
};

const lastIndex = <T,>(xs: T[], ok: (x: T) => boolean) => xs.map(ok).lastIndexOf(true);

/** The asset opened or carted since the last search, if any: what "Found it" most likely refers to. */
function lastPicked(): { id: unknown; name: unknown } | null {
  const log = readStudy();
  const since = log.slice(lastIndex(log, (e) => e.type === "search" || e.type === "task") + 1);
  const e = since[lastIndex(since, (e) => e.type === "open" || e.type === "cart")];
  return e ? { id: e.id, name: e.name } : null;
}

/** The searches since the participant last logged an own-search verdict, newest last. */
function ownSearch(): string | null {
  const log = readStudy();
  const since = log.slice(lastIndex(log, (e) => e.type === "own" || (e.type === "task" && e.task === "OWN")) + 1);
  const q = since[lastIndex(since, (e) => e.type === "search")]?.query;
  return typeof q === "string" ? q : null;
}

const button = (primary: boolean) =>
  `pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40 ${
    primary
      ? "bg-[var(--ink)] text-white"
      : "text-[var(--text-secondary)] ring-1 ring-[var(--hairline-strong)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
  }`;
const pill = (on: boolean) =>
  `pressable rounded-full px-3 py-1.5 text-[13px] ring-1 ${
    on
      ? "bg-[var(--ink)]/[0.08] font-medium text-[var(--text)] ring-[var(--hairline-strong)]"
      : "text-[var(--text-secondary)] ring-[var(--hairline)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
  }`;
const Kbd = ({ children }: { children: ReactNode }) => <kbd className="font-sans text-[11px] opacity-60">{children}</kbd>;

function Note({ value, onChange, onEnter, placeholder }: { value: string; onChange: (v: string) => void; onEnter: () => void; placeholder: string }) {
  return (
    <textarea
      autoFocus
      rows={2}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") e.currentTarget.blur();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        }
      }}
      className="w-full resize-none rounded-[10px] bg-[var(--raised)] px-3 py-2 text-[13.5px] text-[var(--text)] ring-1 ring-[var(--hairline)] outline-none placeholder:text-[var(--text-tertiary)] focus:ring-[var(--hairline-strong)]"
    />
  );
}

function DrawnCheck() {
  return (
    <motion.span
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", duration: 0.5, bounce: 0.4 }}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-white"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.15, ease: [0.23, 1, 0.32, 1] }} />
      </svg>
    </motion.span>
  );
}

/** Walks one participant's schedule. Tasks arrive one at a time, the page reloads into the other layout at the
 * halfway break without naming it, and the log downloads itself at the end. */
export function StudyRunner({ onFreshStart }: { onFreshStart: () => void }) {
  const participant = (schedule.participants as Participant[]).find((p) => p.id === STUDY.run);
  const [list] = useState(() => (participant ? screens(participant) : []));
  const [state, setState] = useState<RunState>(() => load(STUDY.run ?? ""));
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lastSearch, setLastSearch] = useState(ownSearch);
  const [height, setHeight] = useState<number | "auto">("auto");
  const inner = useRef<HTMLDivElement>(null);
  const screen = list[state.pos];

  useEffect(() => save(state), [state]);
  useEffect(() => {
    if (wrongArm(screen)) reloadInto(screen);
  }, []);
  useEffect(() => {
    const fn = () => {
      setLastSearch(ownSearch());
      const last = readStudy().at(-1);
      if (screen?.kind === "task" && state.phase === "brief" && last?.type === "search")
        setState((s) => ({ ...s, phase: "active", startedAt: Date.parse(last.at) }));
      if (screen?.kind === "task" && state.phase === "pick" && (last?.type === "open" || last?.type === "cart")) {
        logStudy("pick", { task: screen.id, id: last.id, name: last.name });
        setState((s) => ({ ...s, phase: "note" }));
      }
    };
    window.addEventListener(STUDY_CHANGED, fn);
    return () => window.removeEventListener(STUDY_CHANGED, fn);
  }, [screen, state.phase]);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (screen?.kind === "own" && !readStudy().some((e) => e.type === "task" && e.task === "OWN")) logStudy("task", { task: "OWN", arm: "routed" });
  }, [screen?.kind]);
  useEffect(() => {
    if (screen?.kind !== "done" || state.saved) return;
    setState((s) => ({ ...s, saved: downloadStudy(`suave-study-${s.participant}.json`) }));
  }, [screen?.kind, state.saved]);

  const go = (pos: number) => {
    const next: RunState = { participant: state.participant, pos, phase: "brief" };
    setNote("");
    setChoice(null);
    setExpanded(false);
    save(next);
    const s = list[pos];
    if (s?.kind === "task") {
      onFreshStart();
      logStudy("task", { task: s.id, arm: s.arm });
    }
    if (wrongArm(s)) return reloadInto(s);
    setState(next);
  };

  if (!participant || !screen) return null;

  const counts = () => {
    const log = readStudy();
    const start = lastIndex(log, (e) => e.type === "session");
    const verdicts = log.slice(Math.max(0, start)).filter((e) => e.type === "verdict");
    const minutes = Math.max(1, Math.round((Date.now() - Date.parse(log[start]?.at ?? "")) / 60000));
    return { found: verdicts.filter((e) => e.found).length, minutes: Number.isFinite(minutes) ? minutes : null };
  };

  let icon: ReactNode = <FlaskConical className="size-4" />;
  let title = "";
  let meta = "";
  let body: ReactNode = null;

  switch (screen.kind) {
    case "welcome":
      title = "Layout study";
      meta = participant.id;
      body = (
        <>
          <p>
            {screen.tasks} short scenarios, then a few searches of your own. Search the way you normally would. The study tests the layout, not
            you.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              autoFocus
              className={button(true)}
              onClick={() => {
                logStudy("session", { participant: participant.id });
                go(1);
              }}
            >
              Start <Kbd>↵</Kbd>
            </button>
          </div>
        </>
      );
      break;
    case "switch":
      icon = <Layers className="size-4" />;
      title = "Halfway";
      meta = `${screen.done} done`;
      body = (
        <>
          <p>The next six work the same way. Results may be laid out a little differently.</p>
          <div className="flex justify-end">
            <button type="button" autoFocus className={button(true)} onClick={() => go(state.pos + 1)}>
              Continue <Kbd>↵</Kbd>
            </button>
          </div>
        </>
      );
      break;
    case "task": {
      icon = <Search className="size-4" />;
      title = `Task ${screen.n}`;
      meta = `${screen.n} of ${screen.of}`;
      const scenario = (clamp: boolean) => (
        <button
          type="button"
          onClick={() => clamp && setExpanded((v) => !v)}
          className={`text-left text-[var(--text)] ${clamp && !expanded ? "line-clamp-3" : ""} ${clamp ? "cursor-pointer" : "cursor-default"}`}
        >
          {screen.scenario}
        </button>
      );
      if (state.phase === "brief")
        body = (
          <>
            <p className="text-[14.5px] leading-[1.5] text-[var(--text)]">{screen.scenario}</p>
            <div className="flex justify-end">
              <button
                type="button"
                autoFocus
                className={button(true)}
                onClick={() => {
                  onFreshStart();
                  setState((s) => ({ ...s, phase: "active", startedAt: Date.now() }));
                }}
              >
                Start task <Kbd>↵</Kbd>
              </button>
            </div>
          </>
        );
      else if (state.phase === "active") {
        const verdict = (found: boolean) => {
          logStudy("verdict", { task: screen.id, found, ms: Date.now() - (state.startedAt ?? Date.now()) });
          const picked = found ? lastPicked() : null;
          if (picked) logStudy("pick", { task: screen.id, ...picked });
          setState((s) => ({ ...s, phase: found && !picked ? "pick" : "note" }));
        };
        body = (
          <>
            {scenario(true)}
            <div className="grid grid-cols-2 gap-2 [&>button]:justify-center">
              <button type="button" className={button(false)} onClick={() => verdict(false)}>
                Not found
              </button>
              <button type="button" className={button(true)} onClick={() => verdict(true)}>
                Found it
              </button>
            </div>
          </>
        );
      } else if (state.phase === "pick") {
        body = (
          <>
            <p className="text-[var(--text)]">Which one? Click it in the results.</p>
            <div className="flex justify-end">
              <button type="button" className={button(false)} onClick={() => setState((s) => ({ ...s, phase: "note" }))}>
                Skip
              </button>
            </div>
          </>
        );
      } else {
        icon = <MessageSquare className="size-4" />;
        const next = () => {
          if (note.trim()) logStudy("note", { task: screen.id, text: note });
          go(state.pos + 1);
        };
        body = (
          <>
            <Note value={note} onChange={setNote} onEnter={next} placeholder="Anything worth remembering? Optional" />
            <div className="flex justify-end">
              <button type="button" className={button(true)} onClick={next}>
                {note.trim() ? "Save and continue" : "Continue"} <Kbd>↵</Kbd>
              </button>
            </div>
          </>
        );
      }
      break;
    }
    case "prefer": {
      icon = <Layers className="size-4" />;
      title = "One question";
      const next = () => {
        if (!choice) return;
        const [first, second] = participant.blocks.map((b) => b.arm);
        logStudy("preference", { choice, first, second, ...(note.trim() && { note }) });
        go(state.pos + 1);
      };
      body = (
        <>
          <p>Which six were easier to work through?</p>
          <div className="flex flex-wrap gap-2">
            {["The first six", "The second six", "About the same"].map((c) => (
              <button key={c} type="button" aria-pressed={choice === c} className={pill(choice === c)} onClick={() => setChoice(c)}>
                {c}
              </button>
            ))}
          </div>
          <Note value={note} onChange={setNote} onEnter={next} placeholder="What made the difference? Optional" />
          <div className="flex justify-end">
            <button type="button" disabled={!choice} className={button(true)} onClick={next}>
              Continue <Kbd>↵</Kbd>
            </button>
          </div>
        </>
      );
      break;
    }
    case "own": {
      icon = <Search className="size-4" />;
      title = "Your own searches";
      const logged = readStudy().filter((e) => e.type === "own").length;
      meta = logged > 0 ? `${logged} logged` : "";
      const record = () => {
        if (!choice || !lastSearch) return;
        logStudy("own", { query: lastSearch, verdict: choice, ...(note.trim() && { note }) });
        setChoice(null);
        setNote("");
      };
      body = lastSearch ? (
        <>
          <p>
            How did the layout do for <span className="font-medium text-[var(--text)]">“{lastSearch}”</span>?
          </p>
          <div className="flex flex-wrap gap-2">
            {["Helped", "Got in the way", "No difference"].map((c) => (
              <button key={c} type="button" aria-pressed={choice === c} className={pill(choice === c)} onClick={() => setChoice(c)}>
                {c}
              </button>
            ))}
          </div>
          {choice && <Note value={note} onChange={setNote} onEnter={record} placeholder="Why? Optional" />}
          <div className="flex justify-end gap-2">
            <button type="button" className={button(false)} onClick={() => go(state.pos + 1)}>
              I'm done
            </button>
            <button type="button" disabled={!choice} className={button(true)} onClick={record}>
              Log it <Kbd>↵</Kbd>
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Search for something you'd look for in real work. When results land, say how the layout did. Two or three is plenty.</p>
          <div className="flex justify-end">
            <button type="button" className={button(logged > 0)} onClick={() => go(state.pos + 1)}>
              {logged > 0 ? "I'm done" : "Skip"} <ArrowRight className="size-3.5" />
            </button>
          </div>
        </>
      );
      break;
    }
    case "done": {
      const { found, minutes } = counts();
      icon = <DrawnCheck />;
      title = "That's everything";
      meta = minutes ? `${minutes} min` : "";
      body = (
        <>
          <p>
            {found} of {screen.tasks} found. Thank you. The log saved to Downloads as{" "}
            <span className="font-medium text-[var(--text)]">{state.saved}</span>.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={button(false)}
              onClick={() => {
                localStorage.removeItem("suave-study-log");
                localStorage.removeItem(KEY);
                location.reload();
              }}
            >
              <RotateCcw className="size-3.5" /> Start over
            </button>
            <button type="button" className={button(true)} onClick={() => downloadStudy(state.saved)}>
              <Download className="size-3.5" /> Download again
            </button>
          </div>
        </>
      );
      break;
    }
    default: {
      const never: never = screen;
      return never;
    }
  }

  const tasksDone = list.slice(0, state.pos).filter((s) => s.kind === "task").length + (screen.kind === "task" && (state.phase === "pick" || state.phase === "note") ? 1 : 0);
  const of = list.filter((s) => s.kind === "task").length;
  const compact = screen.kind === "task" && (state.phase === "active" || state.phase === "pick");

  return (
    <motion.section
      aria-label="Study"
      initial={{ opacity: 0, transform: "translateY(8px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)", height, width: compact ? 220 : 360 }}
      transition={{ ...tween.trayEnter, height: spring.morph, width: spring.morph }}
      className="fixed bottom-3 left-2.5 z-50 max-w-[calc(100vw-20px)] overflow-hidden rounded-[16px] bg-[var(--surface)] shadow-[0_12px_40px_-12px_rgb(0_0_0/0.18)] ring-1 ring-[var(--hairline-strong)]"
    >
      <div ref={inner}>
        <header className="flex items-center gap-3 py-3 pr-4 pl-3">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={screen.kind === "done" ? "done" : title}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={tween.morph}
              className={
                screen.kind === "done"
                  ? "flex"
                  : "flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--raised)] text-[var(--text)] ring-1 ring-[var(--hairline)]"
              }
            >
              {icon}
            </motion.span>
          </AnimatePresence>
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text)]">{title}</h2>
          <span className="shrink-0 text-[12px] text-[var(--text-tertiary)] tabular-nums">{meta}</span>
        </header>
        <div className="flex gap-[3px] px-4" aria-hidden>
          {Array.from({ length: of }, (_, i) => (
            <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--raised)]">
              <motion.span
                className="block h-full origin-left bg-[var(--ink)]"
                initial={false}
                animate={{ transform: `scaleX(${i < tasksDone ? 1 : 0})` }}
                transition={tween.strip}
              />
            </span>
          ))}
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${state.pos}-${state.phase}-${!!lastSearch}`}
            initial={{ opacity: 0, transform: "translateY(4px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0, transform: "translateY(-4px)", pointerEvents: "none" }}
            transition={tween.morph}
            className={`flex flex-col gap-3 px-4 pt-3 pb-4 leading-[1.5] text-[var(--text-secondary)] ${compact ? "text-[13px]" : "text-[13.5px]"}`}
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
