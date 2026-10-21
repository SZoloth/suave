import { BookmarkCheck, PanelLeft, RefreshCw, Search } from "lucide-react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { type Asset, type Space, api, browserRetrieval } from "./api";
import { AssetPanel, AssetSheet } from "./components/AssetPanel";
import { PinStrip, usePinComplements } from "./components/PinStrip";
import { CollectionTray, type TrayResult } from "./components/CollectionTray";
import { type LocalCollection, addToCollection, loadLibraryCollections, loadCollections, mergeCollections, recordCollection } from "./lib/collections";
import { type Overrides } from "./components/IntentBar";
import { Checks } from "./components/Checks";
import { QueryLab } from "./components/QueryLab";
import { Pressable } from "./components/Pressable";
import { GhostPreview } from "./components/GhostPreview";
import { EnterHint, PromptShell, type Reading } from "./components/PromptShell";
import { askedContext, readTurn, refine, stepFrom, threadContext, type Lens, type Step } from "./thread";
import { type ChipId, follow, keptIds, merge, toggleKeep, under } from "./kept";
import { type CardActions, LineupView } from "./components/views";
import { ACT_THRESHOLD, type Intent, type View } from "./intent";
import { loadRecent, pushRecent, timeAgo, type RecentSearch } from "./lib/recent";
import { routedAssets, route, searchingRows, type RouteInput, type Routed } from "./routed";
import { browseTitle, type EffectivePlan, effectivePlan, filtersOf, sortAssets, wantsCheck } from "./plan";
import { tween } from "./motion";
import { type Freshness, type SavedSearch, loadSaved, markOpened, savedKey, toggleSaved } from "./lib/saved";
import { useSettings } from "./lib/settings";
import { sentenceCase, cleanQuery, SurfaceCard, surfaceFor, type SurfaceLifecycle } from "./surfaces";
import { thumb } from "./api";
import { CollectionView } from "./components/CollectionView";
import { addLabel, BesideColumn, GroupBar, NewSearchSlot, PaneFrame } from "./components/GroupBar";
import { SplitPanes } from "./components/SplitPanes";
import { type DragItem, dragStart, PANE_DRAG, Sidebar, SidebarRail } from "./components/Sidebar";
import { HomeFeed, useUpdates } from "./components/UpdatesFeed";
import { StepTrail } from "./components/StepTrail";
import { useThreadTitle } from "./lib/threadTitle";
import { replaySearch } from "./lib/replay";
import { useModelDownload } from "./retrieval/client";
import { STUDY, logStudy } from "./lib/study";
import { StudyRunner } from "./components/StudyRunner";
import { type OpenSearch, type Pane, type Target, focusedGroup, focusedPane, focusedSearch, groupsOf, restoreWorkspace, saveWorkspace, workspaceReducer } from "./workspace";

const EXAMPLES: { q: string; view: View }[] = [
  { q: "find me a lamp thats red", view: "single" },
  { q: "stuff for a smugglers hideout", view: "scene" },
  { q: "compare the barrel and the wooden chair", view: "compare" },
  { q: "how big is the street lamp", view: "scale" },
  { q: "more like a rusty oil drum", view: "similar" },
  { q: "rocks", view: "single" },
];

const NAV_KEY = "suave-nav";
const PINS_KEY = "suave-pins";
const KEPT_KEY = "suave-kept";

const lensOverrides = (lens?: Lens): Overrides => ({ groupBy: lens?.groupBy ?? null, show: lens?.show ?? [] });

/** A pinned step's set is already checked and ordered; only its view still moves. */
const pinnedPlan = (step: Step): EffectivePlan => ({
  set: true,
  lineup: step.routed.kind === "lineup",
  sort: step.sort,
  window: "any",
  author: null,
  facets: {},
  groupBy: step.lens?.groupBy ?? null,
  show: step.lens?.show ?? [],
});

function loadKept(): Overrides {
  try {
    return JSON.parse(sessionStorage.getItem(KEPT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function loadPins(): Asset[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((a): a is Asset => typeof a?.id === "string" && typeof a?.name === "string") : [];
  } catch {
    return [];
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function useNarrow(breakpoint = 960) {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [breakpoint]);
  return narrow;
}

export function App() {
  const [tab, setTab] = useState<"search" | "lab" | "check">("search");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** The next new search opens beside the focused one instead of on its own. */
  const [beside, setBeside] = useState(false);
  const [submitWhenReady, setSubmitWhenReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ws, dispatch] = useReducer(workspaceReducer, undefined, restoreWorkspace);
  const [query, setQuery] = useState("");
  const [settings, updateSettings] = useSettings();
  const space: Space = "fused";
  const [intentRead, setIntentRead] = useState<{ query: string; intent: Intent } | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  /** Chips the artist kept for new searches, until the tab closes. */
  const [kept, setKept] = useState<Overrides>(loadKept);
  useEffect(() => sessionStorage.setItem(KEPT_KEY, JSON.stringify(kept)), [kept]);
  const [routedRead, setRoutedRead] = useState<{ query: string; routed: Routed } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Asset[]>(loadPins);
  useEffect(() => localStorage.setItem(PINS_KEY, JSON.stringify(cart)), [cart]);
  const [open, setOpen] = useState<Asset | null>(null);
  const closeAsset = useCallback(() => setOpen(null), []);
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem(NAV_KEY) === "collapsed");
  /** The sidebar shown anyway while an asset is open, which folds it away by default. */
  const [navPeek, setNavPeek] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [status, setStatus] = useState<{ assets: number | null; jev: boolean } | null>(null);
  const download = useModelDownload(browserRetrieval);
  const [recent, setRecent] = useState<RecentSearch[]>(() => loadRecent());
  const focusedP = focusedPane(ws);
  const focused = focusedSearch(ws);
  const thread: Step[] = useMemo(() => focused?.steps ?? [], [focused]);
  const group = focusedGroup(ws);
  /** The next search joins the focused group: asked for, or the focus is a column that can't be refined. */
  const besideNow = beside || (focusedP != null && focusedP.kind !== "search" && group.length > 1);
  const [preview, setPreview] = useState<{ line: string; step: Step } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>(() => loadSaved());
  /** Saved searches being opened: record the look once their replay lands. */
  const marks = useRef(new Set<string>());
  const replaying = useRef(new Set<string>());
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const current = thread.at(-1) ?? null;
  const previous = thread.length > 0 ? threadContext(thread) : undefined;
  const ghostRef = useRef<Routed | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query.trim(), 150);
  // A read of the previous line must not plan or show results for this one.
  const intent = intentRead?.query === debounced ? intentRead.intent : null;
  const routed = routedRead?.query === debounced ? routedRead.routed : null;
  const narrow = useNarrow(960);
  const complements = usePinComplements(cart);

  useEffect(() => {
    api.status().then(setStatus);
  }, []);

  useEffect(() => {
    setOverrides({});
    if (debounced.length < 2) return setIntentRead(null);
    const ctrl = new AbortController();
    api
      .intent(debounced, ctrl.signal, previous)
      .then((i) => setIntentRead({ query: debounced, intent: i }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [debounced, previous]);

  /** What's in force: kept chips the words don't replace, then this search's own edits. */
  const live = useMemo(() => merge(under(kept, intent), overrides), [kept, intent, overrides]);
  const plan = useMemo(() => effectivePlan(intent, live, settings.setSort), [intent, live, settings.setSort]);
  const override = (next: Overrides) => {
    if (next.sort && next.sort !== live.sort && plan.set && !plan.lineup) updateSettings({ setSort: next.sort });
    setOverrides(next);
    setKept((k) => follow(k, effectivePlan(intent, merge(under(k, intent), next), settings.setSort)));
  };
  const keep = { kept: keptIds(kept), onKeep: (id: ChipId) => setKept((k) => toggleKeep(k, id, plan)) };

  const view: View = useMemo(() => {
    if (overrides.view) return overrides.view;
    if (STUDY.layout === "plain") return "single";
    if (plan.set) return plan.lineup ? "lineup" : "single";
    if (!intent || intent.view.value === "none" || intent.view.confidence < ACT_THRESHOLD) return "single";
    return intent.view.value;
  }, [intent, overrides.view, plan.set, plan.lineup]);

  useEffect(() => {
    if (debounced.length >= 2) logStudy("search", { query: debounced });
  }, [debounced]);
  useEffect(() => {
    if (!routedRead) return;
    const r = routedRead.routed;
    logStudy("results", { query: routedRead.query, kind: r.kind, matches: routedAssets(r).length, ...("set" in r && { nearby: r.set.nearby.length }) });
  }, [routedRead]);
  useEffect(() => {
    if (routedRead) logStudy("view", { query: routedRead.query, view, count: intent?.count.value });
  }, [routedRead, view, intent]);
  useEffect(() => {
    if (open) logStudy("open", { id: open.id, name: open.name });
  }, [open]);

  const read = current && !beside ? readTurn(intent, overrides.turn) : null;
  const working = read != null && read.turn !== "new";
  const action = intent?.action?.value ?? "none";
  const followAction = working && read.turn === "act" && (action === "add_to_cart" || action === "create_collection") ? action : null;
  const refining = working && !followAction;

  useEffect(() => {
    if (!current || !refining || !intent) return;
    const ctrl = new AbortController();
    refine(current, intent, debounced.trim(), ctrl.signal)
      .then((step) => setPreview({ line: debounced, step }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [current, refining, intent, debounced]);

  const check = wantsCheck(intent);
  const facetKey = JSON.stringify(plan.facets);
  const routeInput: RouteInput = useMemo(
    () => ({
      about: plan.browse ? browseTitle(plan) : (intent?.plan.about ?? debounced),
      subject: overrides.subject,
      exact: overrides.exact,
      filters: filtersOf(plan),
      check,
      browse: plan.browse,
    }),
    // The modifiedSince filter moves with the clock; re-route only when a filter changes.
    [intent, debounced, overrides.subject, overrides.exact, plan.author, plan.window, facetKey, check],
  );

  useEffect(() => {
    if (debounced.length < 2) {
      setRoutedRead(null);
      setLoading(false);
      return;
    }
    if (!intent || working) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    route(debounced, view, space, routeInput, ctrl.signal, (partial) => setRoutedRead({ query: debounced, routed: partial }))
      .then((r) => {
        ghostRef.current = r;
        setRoutedRead({ query: debounced, routed: r });
        const assets = routedAssets(r);
        const corrected = "result" in r && !overrides.subject ? r.result.corrected : null;
        pushRecent({
          query: corrected ?? debounced,
          view,
          thumbIds: assets.slice(0, 3).map((a) => a.id),
          names: [...new Set(assets.map((a) => a.name.replace(/\s+\d+$/, "")))].slice(0, 3),
          count: assets.length,
          at: Date.now(),
        });
        setRecent(loadRecent());
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [intent, view, space, routeInput, debounced, working]);

  const lifecycle: SurfaceLifecycle = useMemo(() => {
    if (!query.trim() || debounced.length < 2) return { status: "home" };
    if (!intent || (loading && !searchingRows(routed))) return { status: "deciding", ghost: routed ?? ghostRef.current };
    if (!routed) return { status: "deciding", ghost: null };
    return { status: "ready", routed };
  }, [query, debounced, intent, loading, routed]);

  useEffect(() => {
    if (lifecycle.status !== "ready" || searchingRows(lifecycle.routed)) return;
    const assets = routedAssets(lifecycle.routed);
    performance.mark("suave:settled", { detail: { query: debounced, count: assets.length, ids: assets.slice(0, 12).map((a) => a.id) } });
  }, [lifecycle, debounced]);

  const reading: Reading =
    query.trim().length < 2 ? { status: "idle" } : query.trim() !== debounced || !intent ? { status: "reading" } : { status: "understood", intent };

  const cartIds = useMemo(() => new Set(cart.map((a) => a.id)), [cart]);
  const toggleCart = useCallback((a: Asset) => {
    logStudy("cart", { id: a.id, name: a.name });
    setCart((c) => (c.some((x) => x.id === a.id) ? c.filter((x) => x.id !== a.id) : [...c, a]));
  }, []);
  const addAll = useCallback((as: Asset[]) => setCart((c) => [...c, ...as.filter((a) => !c.some((x) => x.id === a.id))]), []);
  const [collecting, setCollecting] = useState<{ assets: Asset[]; name: string; targetId?: string | null } | null>(null);
  const onCollect = useCallback((assets: Asset[], name: string) => setCollecting({ assets, name }), []);
  const [localCollections, setCollections] = useState<LocalCollection[]>(loadCollections);
  const [libraryCollections, setLibraryCollections] = useState<LocalCollection[]>([]);
  useEffect(() => {
    loadLibraryCollections().then(setLibraryCollections);
  }, []);
  const collections = useMemo(() => mergeCollections(localCollections, libraryCollections), [localCollections, libraryCollections]);
  const updates = useUpdates(saved, collections, settings.setSort, () => setSaved(loadSaved()));
  const collected = (r: TrayResult) => {
    setCollecting(null);
    const n = `${r.assets.length} ${r.assets.length === 1 ? "asset" : "assets"}`;
    if (r.kind === "created") {
      setCollections(recordCollection(r.id, r.name, r.visible, r.assets));
      setToast({ text: `Created "${r.name}" with ${n}${r.visible ? ", visible to others" : ""}` });
    } else {
      const target = collections.find((c) => c.id === r.id);
      if (target) setCollections(addToCollection(target, r.assets));
      setToast({ text: `Added ${n} to "${r.name}"` });
    }
  };
  const actions: CardActions = { cartIds, onToggleCart: toggleCart, onAddAll: addAll, onOpen: setOpen, onCollect };

  const understood = reading.status === "understood";
  const previewed = preview?.line === debounced ? preview.step : null;
  const previewFits = previewed != null && previewed.routed.set.members.length > 0;
  const shownStep: { step: Step; ghost: boolean } | null = !current || beside
    ? null
    : !query.trim()
      ? { step: current, ghost: false }
      : !understood
        ? { step: current, ghost: true }
        : refining
          ? { step: previewFits ? previewed : current, ghost: !previewFits }
          : followAction
            ? { step: current, ghost: false }
            : null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const leaveThread = (keep = 0) => {
    dispatch(keep > 0 ? { type: "truncate", keep } : { type: "focus", id: null });
    setQuery("");
    inputRef.current?.focus();
  };

  const baseStep =
    !working && understood && lifecycle.status === "ready" && !searchingRows(lifecycle.routed)
      ? stepFrom(lifecycle.routed, plan, sentenceCase(cleanQuery("about" in lifecycle.routed ? lifecycle.routed.about : debounced)), debounced)
      : null;

  useEffect(() => {
    for (const p of group) {
      if (p.kind !== "search" || p.steps || replaying.current.has(p.id)) continue;
      replaying.current.add(p.id);
      replaySearch(p.query, p.lines, settings.setSort, new AbortController().signal)
        .then((steps) => {
          dispatch({ type: "loaded", id: p.id, steps });
          if (!marks.current.delete(p.id)) return;
          setFreshness(markOpened(savedKey(p.query, p.lines), steps[steps.length - 1].routed.set.members.map((a) => a.id)));
          setSaved(loadSaved());
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => replaying.current.delete(p.id));
    }
  }, [group, settings.setSort]);

  useEffect(() => {
    if (!open) setNavPeek(false);
  }, [open]);

  useEffect(() => saveWorkspace(ws), [ws]);

  const baseAction =
    baseStep && intent?.action && intent.action.confidence >= ACT_THRESHOLD && (action === "add_to_cart" || action === "create_collection") ? action : null;

  const collectLine = (followAction ?? baseAction) === "create_collection" && collections.length > 0 ? debounced : null;
  const [picked, setPicked] = useState<{ line: string; id: string | null } | null>(null);
  useEffect(() => {
    if (!collectLine) return;
    const ctrl = new AbortController();
    api
      .pickCollection(collectLine, collections.map((c) => c.name), ctrl.signal)
      .then((r) => setPicked({ line: collectLine, id: r.index != null && r.confidence >= 0.5 ? (collections[r.index]?.id ?? null) : null }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [collectLine, collections]);
  const pickedCollection = picked && picked.line === collectLine ? (collections.find((c) => c.id === picked.id) ?? null) : null;

  const perform = (act: "add_to_cart" | "create_collection", step: Step) => {
    const assets = sortAssets(step.routed.set.members, step.sort);
    if (act === "create_collection") return setCollecting({ assets, name: sentenceCase(cleanQuery(step.routed.about)), targetId: pickedCollection?.id ?? null });
    const fresh = assets.filter((a) => !cartIds.has(a.id));
    setCart((c) => [...c, ...fresh]);
    setToast(
      fresh.length > 0
        ? { text: `Pinned ${fresh.length}`, undo: () => setCart((c) => c.filter((x) => !fresh.some((f) => f.id === x.id))) }
        : { text: "Already pinned" },
    );
  };

  const submit = (besideKey = false) => {
    if (besideKey && focused && working) {
      setBeside(true);
      setSubmitWhenReady(true);
      return;
    }
    if (!understood) return;
    if (current && working) {
      if (followAction) perform(followAction, current);
      else if (previewFits) dispatch({ type: "push", step: previewed });
      else return;
      setQuery("");
        return;
    }
    if (!baseStep) return;
    dispatch({ type: "start", id: crypto.randomUUID(), steps: [baseStep], beside: besideNow || besideKey });
    setBeside(false);
    setQuery("");
    if (baseAction) perform(baseAction, baseStep);
  };

  const shownCount = current?.routed.set.members.length ?? 0;
  const turnSwitch = (turn: "new" | "refine", label: string) => (
    <button type="button" onClick={() => override({ ...overrides, turn })} className="text-[var(--accent)] [@media(hover:hover)_and_(pointer:fine)]:hover:underline">
      {label}
    </button>
  );
  const actionLabel = (act: "add_to_cart" | "create_collection", assets: Asset[]) => {
    const into =
      act === "add_to_cart"
        ? { name: "your pins", held: cartIds }
        : pickedCollection && { name: pickedCollection.name, held: new Set(pickedCollection.assets.map((a) => a.id)) };
    if (!into) return `Makes a collection of ${assets.length}`;
    const fresh = assets.filter((a) => !into.held.has(a.id)).length;
    if (fresh === 0) return `All ${assets.length} are already in ${into.name}`;
    return `Adds ${fresh} to ${into.name}${fresh < assets.length ? ` · ${assets.length - fresh} already there` : ""}`;
  };
  const followUpRow: ReactNode = !current || beside ? (
    !baseStep ? null : baseAction ? (
      <>
        <span className="text-[var(--text)]">{actionLabel(baseAction, baseStep.routed.set.members)}</span>
        <EnterHint />
      </>
    ) : (
      <EnterHint>{beside ? "Open beside" : "Refine these"}</EnterHint>
    )
  ) : !understood ? null : followAction ? (
    <>
      <span className="text-[var(--text)]">{actionLabel(followAction, current.routed.set.members)}</span>
      <EnterHint />
      {turnSwitch("new", "Search the whole library instead")}
    </>
  ) : refining ? (
    <>
      <span className={previewed && !previewFits ? "text-amber-700" : "text-[var(--text)]"}>
        {!previewed
          ? `Working on these ${shownCount}`
          : !previewFits
            ? `None of these ${shownCount} fit`
            : previewed.routed.set.members.length < shownCount
              ? `${previewed.routed.set.members.length} of these ${shownCount}`
              : `${action === "line_up" ? "Lines up" : "Reorders"} these ${shownCount}`}
      </span>
      {previewFits && <EnterHint />}
      {!read?.sure && !overrides.turn && <span className="text-amber-700">not sure</span>}
      {turnSwitch("new", "Search the whole library instead")}
    </>
  ) : (
    <>
      <span className="text-[var(--text-secondary)]">New search</span>
      {baseStep && <EnterHint />}
      {!read?.sure && !overrides.turn && <span className="text-amber-700">not sure</span>}
      {turnSwitch("refine", `Work on these ${shownCount} instead`)}
    </>
  );

  const runExample = (q: string) => {
    setTab("search");
    setQuery(q);
    inputRef.current?.focus();
  };
  const showCanvas = () => {
    setTab("search");
    setSidebarOpen(false);
    setQuery("");
  };
  const openSearchOf = (key: string) => ws.panes.find((p): p is OpenSearch => p.kind === "search" && savedKey(p.query, p.lines) === key);
  /** Adds a saved search to the canvas; it replays off screen once it's in view. */
  const addSaved = (s: SavedSearch, beside: boolean) => {
    const id = crypto.randomUUID();
    marks.current.add(id);
    dispatch({ type: "add", id, query: s.query, lines: s.lines, beside });
  };
  const openSaved = (s: SavedSearch) => {
    showCanvas();
    const open = openSearchOf(savedKey(s.query, s.lines));
    if (open) dispatch({ type: "focus", id: open.id });
    else addSaved(s, false);
  };
  const openTarget = (target: Target, beside = false) => {
    showCanvas();
    dispatch({ type: "open", id: crypto.randomUUID(), target, beside });
  };
  const focusPane = (p: Pane) => {
    showCanvas();
    dispatch({ type: "focus", id: p.id });
  };
  /** Puts an item in pane `into`'s group, or the focused pane's when `into` is null. */
  const place = (item: DragItem, into: string | null) => {
    const anchor = into ?? ws.focus;
    if (!anchor) return;
    showCanvas();
    dispatch({ type: "focus", id: anchor });
    switch (item.kind) {
      case "pane":
        return dispatch({ type: "join", id: item.id, into: anchor });
      case "collection":
        return dispatch({ type: "open", id: crypto.randomUUID(), target: { kind: "collection", collectionId: item.id }, beside: true });
      case "saved": {
        const open = openSearchOf(item.key);
        if (open) return dispatch({ type: "join", id: open.id, into: anchor });
        const s = saved.find((x) => savedKey(x.query, x.lines) === item.key);
        return s && addSaved(s, true);
      }
      default: {
        const never: never = item;
        return never;
      }
    }
  };
  const collectionOf = (p: Pane) => (p.kind === "collection" ? (collections.find((c) => c.id === p.collectionId) ?? null) : null);
  const baseLabel = (p: Pane) =>
    p.kind === "search" ? (p.steps?.[0].label ?? sentenceCase(cleanQuery(p.query))) : p.kind === "pinned" ? "Pinned" : (collectionOf(p)?.name ?? "Collection");
  const paneLabel = (p: Pane) => (p.kind === "search" ? [baseLabel(p), ...p.lines].join(" › ") : baseLabel(p));
  const paneAssets = (p: Pane) => {
    if (p.kind === "collection") return collectionOf(p)?.assets ?? null;
    if (p.kind === "pinned") return cart;
    const last = p.kind === "search" ? p.steps?.at(-1) : null;
    return last ? sortAssets(last.routed.set.members, last.sort) : null;
  };
  const split = !narrow && group.length > 1;
  /** The "+" column was chosen: a new search fills a column of its own before Enter makes it real. */
  const slotOpen = beside && split;
  const base = thread[0] ?? null;
  const liveKey = savedKey(debounced, []);
  const liveSaved = saved.some((s) => savedKey(s.query, s.lines) === liveKey);
  const saveLive = () => {
    if (!surfaceReady) return;
    setSaved(toggleSaved(debounced, [], sentenceCase(cleanQuery(debounced)), routedAssets(surfaceReady).map((a) => a.id)));
  };
  const threadLines = thread.slice(1).map((s) => s.label);
  const threadTitle = useThreadTitle(thread.map((s) => s.label));
  const threadKey = base ? savedKey(base.query, threadLines) : null;
  const threadSaved = threadKey != null && saved.some((s) => savedKey(s.query, s.lines) === threadKey);
  const saveThread = () => {
    if (!base) return;
    setSaved(
      toggleSaved(
        base.query,
        threadLines,
        [sentenceCase(cleanQuery(base.query)), ...threadLines].join(" › "),
        thread[thread.length - 1].routed.set.members.map((a) => a.id),
      ),
    );
  };
  const threadSave = { saved: threadSaved, onToggle: saveThread, hint: thread.length > 1 ? "Reruns the search and each step when you open it" : "Reruns each time you open it" };
  const freshNote = (key: string | null) =>
    freshness && freshness.key === key ? (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
        <BookmarkCheck className="size-4 text-[var(--accent)]" aria-hidden />
        {freshness.fresh > 0
          ? `${freshness.fresh} new since you last looked, ${timeAgo(freshness.since)}`
          : `Nothing new since you last looked, ${timeAgo(freshness.since)}`}
      </p>
    ) : null;

  const newSearch = () => {
    setTab("search");
    setSidebarOpen(false);
    setBeside(false);
    leaveThread();
  };
  const newSearchRef = useRef(newSearch);
  newSearchRef.current = newSearch;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        newSearchRef.current();
      } else if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onDragStart = (e: DragEvent) => e.dataTransfer?.types.includes(PANE_DRAG) && setDragging(true);
    const onDragEnd = () => setDragging(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDragEnd);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onDragEnd);
    };
  }, []);

  useEffect(() => setBeside(false), [ws.focus]);
  useEffect(() => {
    if (!submitWhenReady || !baseStep) return;
    setSubmitWhenReady(false);
    submit();
  }, [submitWhenReady, baseStep]);

  const nextTarget =
    group.length > 1 && focusedP ? () => focusPane(group[(group.findIndex((p) => p.id === focusedP.id) + 1) % group.length]) : undefined;
  const toggleNav = () => {
    if (open) return setNavPeek((v) => !v);
    localStorage.setItem(NAV_KEY, navCollapsed ? "open" : "collapsed");
    setNavCollapsed((v) => !v);
  };
  const navShown = open ? navPeek : !navCollapsed;
  const updateCount = updates.checking === saved.length && saved.length > 0 ? null : updates.items.length;

  const homeComplements = cart.length > 0 ? complements : [];

  const home = !focusedP && lifecycle.status === "home";
  const following = saved.length > 0 || collections.some((c) => c.sample);
  const prompt = (
    <PromptShell
      query={query}
      onQuery={setQuery}
      inputRef={inputRef}
      reading={reading}
      view={view}
      overrides={live}
      onOverride={override}
      setSort={settings.setSort}
      onSubmit={submit}
      placeholder={besideNow ? "Search to open beside" : current && focused ? `Narrow ${baseLabel(focused).toLowerCase()}, or search something new` : undefined}
      target={group.length > 1 && focusedP && !besideNow ? baseLabel(focusedP) : undefined}
      onNextTarget={nextTarget}
      onLeave={narrow && thread.length > 0 ? () => leaveThread() : undefined}
      followUp={followUpRow}
      followUpOnly={working}
      note={
        download &&
        (download.loaded < download.total
          ? `Loading search · ${Math.round(download.loaded / 1e6)} of ${Math.round(download.total / 1e6)} MB, only on your first visit`
          : "Getting search ready, only on your first visit")
      }
    />
  );

  const surfaceReady = lifecycle.status === "ready" ? lifecycle.routed : lifecycle.status === "deciding" ? lifecycle.ghost : null;
  const showGhost = lifecycle.status === "deciding";

  const trailSteps = shownStep && shownStep.step !== current ? [...thread, shownStep.step] : thread;
  /** A suggested follow-up refines what's on screen, so a live search becomes the thread's first step before the line goes in. */
  const ask = (line: string) => {
    if (!current) submit();
    setQuery(line);
    inputRef.current?.focus();
  };
  const focusedView = (
    <>
      {thread.length > 0 && !query.trim() && <div className={split ? "px-3 pt-2" : "mt-2"}>{freshNote(threadKey)}</div>}

      {shownStep && (
        <div className={split ? "" : "mt-4"}>
          <GhostPreview ghost={shownStep.ghost}>
            <SurfaceCard
              routed={shownStep.step.from ?? shownStep.step.routed}
              query={thread[0].label}
              title={shownStep.step === current && thread.length > 1 ? (threadTitle ?? undefined) : undefined}
              trail={
                trailSteps.length > 1 && <StepTrail steps={trailSteps} onStep={(i) => leaveThread(i + 1)} dimmed={shownStep.ghost} />
              }
              debounced={shownStep.step.label}
              overrides={lensOverrides(shownStep.step.lens)}
              onOverride={shownStep.step === current ? (o) => dispatch({ type: "relens", lens: { groupBy: o.groupBy ?? null, show: o.show ?? [] } }) : undefined}
              lensOnly
              plan={pinnedPlan(shownStep.step)}
              actions={actions}
              ghost={shownStep.ghost}
              save={threadSave}
              chrome={split ? "bare" : group.length > 1 ? "card" : "page"}
              compose={{ context: askedContext(trailSteps), onAsk: ask }}
            />
          </GhostPreview>
        </div>
      )}

      {!shownStep && lifecycle.status !== "home" && (
        <div className={split ? "space-y-4" : "mt-4 space-y-4"}>
          {error && <p className="text-[13px] text-amber-700">Search failed: {error}.{browserRetrieval ? "" : " Is the retrieval server running?"}</p>}
          {surfaceReady && intent && (
            <GhostPreview ghost={showGhost}>
              <SurfaceCard
                routed={surfaceReady}
                query={query}
                debounced={debounced}
                overrides={live}
                onOverride={override}
                keep={keep}
                plan={plan}
                actions={actions}
                ghost={showGhost}
                save={thread.length === 0 && debounced.trim() ? { saved: liveSaved, onToggle: saveLive, hint: "Reruns each time you open it" } : undefined}
                chrome={split ? "bare" : group.length > 1 ? "card" : "page"}
                compose={{ context: debounced, onAsk: ask }}
              />
            </GhostPreview>
          )}
        </div>
      )}
    </>
  );
  /** A search beside the focused one: its card alone, since the column carries its name and path. */
  const paneView = (step: Step) => (
    <SurfaceCard
      routed={step.from ?? step.routed}
      query={step.label}
      debounced={step.label}
      overrides={lensOverrides(step.lens)}
      plan={pinnedPlan(step)}
      actions={actions}
      chrome="bare"
    />
  );
  const pending = (p: OpenSearch) => (
    <p className={`flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--text-tertiary)] ${split ? "" : "mt-4"}`}>
      {error ? (
        `Couldn't run ${baseLabel(p).toLowerCase()} again: ${error}`
      ) : (
        <>
          <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Running {baseLabel(p).toLowerCase()} again
        </>
      )}
    </p>
  );
  /** What a pane shows. The focused one shows what's being typed, so a new search previews in place. */
  const paneBody = (p: Pane, inPane: boolean): ReactNode => {
    if (p.id === ws.focus && !slotOpen && (query.trim() || (p.kind === "search" && p.steps))) return focusedView;
    switch (p.kind) {
      case "search":
        return p.steps ? paneView(p.steps[p.steps.length - 1]) : pending(p);
      case "collection": {
        const c = collectionOf(p);
        return c ? (
          <CollectionView collection={c} cartIds={cartIds} onAdd={addAll} onToggleCart={toggleCart} onOpen={setOpen} inPane={inPane} />
        ) : (
          <p className="px-3 py-10 text-[13px] text-[var(--text-tertiary)]">This collection is no longer in Library.</p>
        );
      }
      case "pinned":
        return cart.length > 0 ? (
          <div className={inPane ? "px-3 pb-3" : "mt-4"}>
            <LineupView assets={cart} order="In the order you pinned them" actions={actions} />
          </div>
        ) : (
          <p className="px-3 py-10 text-[13px] text-[var(--text-tertiary)]">Pin assets to compare them here.</p>
        );
      default: {
        const never: never = p;
        return never;
      }
    }
  };

  const width = split ? "max-w-none md:px-6" : "max-w-6xl md:px-8";
  const sidebar = (
    <Sidebar
      groups={groupsOf(ws)}
      focus={tab === "search" ? ws.focus : null}
      saved={saved}
      collections={collections}
      updates={updateCount}
      home={home && tab === "search"}
      tab={tab}
      status={status?.assets == null ? "Search engine offline" : `${status.assets} sample assets`}
      labelOf={paneLabel}
      countOf={(p) => paneAssets(p)?.length ?? null}
      canOpenBeside={(item) => focusedP != null && (item.kind !== "pane" || ws.panes.find((p) => p.id === item.id)?.group !== focusedP.group)}
      onNew={newSearch}
      onOpen={focusPane}
      onPlace={place}
      onDetach={(p) => dispatch({ type: "detach", id: p.id })}
      onSeparate={(g) => dispatch({ type: "separate", group: g })}
      onRemove={(p) => dispatch({ type: "remove", id: p.id })}
      onOpenSaved={openSaved}
      onOpenCollection={(c) => openTarget({ kind: "collection", collectionId: c.id })}
      onTab={(t) => {
        setTab(t);
        setSidebarOpen(false);
      }}
      onCollapse={narrow ? undefined : toggleNav}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full bg-[var(--bg)] text-[var(--text)]">
        {narrow ? (
          sidebarOpen && (
            <>
              <button type="button" aria-label="Hide searches" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-20 bg-black/20" />
              <div className="fixed inset-y-0 left-0 z-30 shadow-[16px_0_48px_-16px_rgb(0_0_0/0.12)]">{sidebar}</div>
            </>
          )
        ) : navShown ? (
          sidebar
        ) : (
          <SidebarRail onExpand={toggleNav} onNew={newSearch} updates={updateCount} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
        {narrow && (
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--hairline)] px-3">
            <Pressable
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Hide searches" : "Show searches"}
              aria-expanded={sidebarOpen}
              className="flex size-8 items-center justify-center rounded-[8px] text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.06]"
            >
              <PanelLeft className="size-4" aria-hidden />
            </Pressable>
            <span className="text-[14px] font-semibold tracking-tight">
              Suave <span className="font-normal text-[var(--text-tertiary)]">Modeling</span>
            </span>
          </header>
        )}

        <LayoutGroup>
          <div className="relative flex min-h-0 flex-1">
            <main
              onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
              className={`min-w-0 flex-1 overflow-x-hidden ${split ? "flex flex-col overflow-y-hidden" : "overflow-y-auto"} ${cart.length > 0 ? "pb-24" : ""}`}
            >
              {tab === "lab" ? (
                <QueryLab onRun={runExample} />
              ) : tab === "check" ? (
                <Checks space={space} />
              ) : (
                <>
                    <div className={`sticky top-0 z-20 border-b bg-[var(--bg)]/85 backdrop-blur-md transition-[border-color] duration-150 ${scrolled ? "border-[var(--hairline)]" : "border-transparent"}`}>
                      <div className={`mx-auto w-full space-y-3 px-4 pt-4 pb-3 ${width}`}>
                        {prompt}
                      </div>
                    </div>
                <div className={`mx-auto flex w-full flex-col px-4 ${split ? "min-h-0 flex-1" : ""} ${width} ${home ? "pt-6 pb-10" : "pb-5"}`}>
                  {home && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tween.trayEnter} className="space-y-6">
                      {following && <HomeFeed updates={updates} onOpenSaved={openSaved} onOpenCollection={(c) => openTarget({ kind: "collection", collectionId: c.id })} />}
                      {recent.length === 0 && !STUDY.run && (
                      <div>
                        {following ? (
                          <h2 className="text-[13px] font-medium text-[var(--text)]">Try a search</h2>
                        ) : (
                          <>
                            <h2 className="text-[13.5px] font-medium text-[var(--text)]">Nothing here yet</h2>
                            <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">Save a search and anything new that matches it shows up here. Try one of these.</p>
                          </>
                        )}
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {EXAMPLES.map(({ q, view: v }) => {
                          const Icon = surfaceFor(v).icon;
                          return (
                            <Pressable
                              key={q}
                              onClick={() => runExample(q)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)]/[0.04] py-1.5 pr-3 pl-2.5 text-[13px] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.08] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
                            >
                              <Icon className="size-3.5 text-[var(--text-tertiary)]" aria-hidden />
                              {q}
                            </Pressable>
                          );
                        })}
            </div>
            </div>
                      )}

                      {recent.length > 0 && !STUDY.run && (
                        <section className="overflow-hidden rounded-[16px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]">
                          <h2 className="flex items-baseline justify-between px-4 pt-3.5 pb-2 text-[13px] font-medium text-[var(--text)]">
                            Pick up where you left off
                            <span className="text-[12px] font-normal text-[var(--text-tertiary)] tabular-nums">{recent.length}</span>
                          </h2>
                          <ul>
                            {recent.map((r) => {
                              const Icon = surfaceFor(r.view).icon;
                              return (
                                <li key={r.query} className="border-t border-[var(--hairline)] first:border-t-0">
                                  <Pressable
                                    onClick={() => runExample(r.query)}
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.03]"
                                  >
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--raised)] ring-1 ring-[var(--hairline)]">
                                      <Icon className="size-4 text-[var(--text-secondary)]" aria-hidden />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-baseline gap-2">
                                        <span className="truncate text-[13.5px] font-medium text-[var(--text)]">“{r.query}”</span>
                                        <span className="shrink-0 text-[11.5px] text-[var(--text-tertiary)]">{timeAgo(r.at)}</span>
                                      </span>
                                      <span className="block truncate text-[12px] text-[var(--text-tertiary)]">
                                        {r.count} {r.count === 1 ? "asset" : "assets"}
                                        {r.names.length > 0 && ` · ${r.names.join(", ")}`}
                                      </span>
                                    </span>
                                    <span className="hidden shrink-0 sm:flex">
                                      {r.thumbIds.map((id, i) => (
                                        <img
                                          key={id}
                                          src={thumb(id)}
                                          alt=""
                                          className={`size-9 rounded-[9px] bg-[var(--raised)] object-contain p-0.5 ring-2 ring-[var(--surface)] ${i > 0 ? "-ml-2.5" : ""}`}
                                        />
                                      ))}
                                    </span>
                                  </Pressable>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      )}

                      {homeComplements.length > 0 && (
                        <section>
                          <h2 className="mb-2.5 text-[13px] font-medium text-[var(--text)]">
                            Goes with your pins <span className="font-normal text-[var(--text-tertiary)]">· tap to pin</span>
                          </h2>
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                            {homeComplements.map((a) => (
                              <Pressable
                                key={a.id}
                                onClick={() => toggleCart(a)}
                                title={a.name}
                                className="hover-lift aspect-square overflow-hidden rounded-[12px] bg-[var(--surface)] ring-1 ring-[var(--hairline)]"
                              >
                                <img src={thumb(a.id)} alt={a.name} className="h-full w-full object-contain p-1.5" />
                              </Pressable>
                            ))}
                          </div>
      </section>
                      )}
                    </motion.div>
                  )}

                  {group.length > 1 && focusedP && (
                    <div className="mt-2">
                      <GroupBar
                        title={group.map(baseLabel).join(", ")}
                        group={group}
                        focusedId={focusedP.id}
                        tabs={narrow}
                        labelOf={paneLabel}
                        assetsOf={paneAssets}
                        cartIds={cartIds}
                        onAdd={addAll}
                        onFocus={focusPane}
                        onDetach={(p) => dispatch({ type: "detach", id: p.id })}
                      />
                    </div>
                  )}

                  <AnimatePresence>
                    {collecting && (
                      <CollectionTray
                        key={collecting.name + collecting.assets.length + (collecting.targetId ?? "")}
                        targetId={collecting.targetId}
                        assets={collecting.assets}
                        suggestedName={collecting.name}
                        collections={collections}
                        onCancel={() => setCollecting(null)}
                        onDone={collected}
                      />
                    )}
                  </AnimatePresence>

                  {split && focusedP ? (
                    <div className="mt-4 flex min-h-0 flex-1 gap-3">
                      <div className="min-h-0 min-w-0 flex-1">
                        <SplitPanes
                          panes={group.map((p) => {
                            const assets = paneAssets(p);
                            return {
                              key: p.id,
                              label: paneLabel(p),
                              node: (
                                <PaneFrame
                                  name={baseLabel(p)}
                                  count={assets?.length ?? null}
                                  path={p.kind === "search" && p.id !== focusedP.id && p.lines.length > 0 ? paneLabel(p) : null}
                                  focused={!slotOpen && p.id === focusedP.id}
                                  onFocus={() => {
                                    setBeside(false);
                                    focusPane(p);
                                  }}
                                  adds={assets ? addLabel(assets, cartIds).adds : []}
                                  onAdd={addAll}
                                  onDetach={() => dispatch({ type: "detach", id: p.id })}
                                  onDragStart={dragStart({ kind: "pane", id: p.id })}
                                >
                                  {paneBody(p, true)}
                                </PaneFrame>
                              ),
                            };
                          }).concat(
                            slotOpen
                              ? [
                                  {
                                    key: "new-search",
                                    label: "New search",
                                    node: (
                                      <NewSearchSlot count={query.trim() && surfaceReady ? routedAssets(surfaceReady).length : null} onCancel={() => setBeside(false)}>
                                        {query.trim() ? (
                                          focusedView
                                        ) : (
                                          <button type="button" onClick={() => inputRef.current?.focus()} className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-[var(--text-tertiary)]">
                                            <Search className="size-4" aria-hidden />
                                            Type a search to open here
                                          </button>
                                        )}
                                      </NewSearchSlot>
                                    ),
                                  },
                                ]
                              : [],
                          )}
                        />
                      </div>
                      {!slotOpen && (
                        <BesideColumn
                          dragging={dragging}
                          onDrop={(item) => place(item, null)}
                          onAdd={() => {
                            setBeside(true);
                            setQuery("");
                            inputRef.current?.focus();
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <div className={focusedP && !narrow && dragging ? "flex gap-3" : ""}>
                      <div className={`min-w-0 flex-1 ${focusedP && focusedP.kind !== "search" && !query.trim() ? "mt-3" : ""}`}>{focusedP ? paneBody(focusedP, false) : focusedView}</div>
                      {focusedP && !narrow && dragging && (
                        <div className="mt-4 flex">
                          <BesideColumn dragging onDrop={(item) => place(item, null)} />
                        </div>
                      )}
                    </div>
      )}
    </div>
                </>
              )}
            </main>
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
              <AnimatePresence>
                {cart.length > 0 && tab === "search" && (
                  <PinStrip
                    key="pinned"
                    assets={cart}
                    openId={open?.id ?? null}
                    onOpen={setOpen}
                    onUnpin={toggleCart}
                    onCompare={() => openTarget({ kind: "pinned" }, focusedP != null)}
                    onSave={(assets) => setCollecting({ assets, name: "Pinned assets" })}
                    onClear={() => setCart([])}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </LayoutGroup>
        </div>

        <AnimatePresence>
          {open && !narrow && (
            <AssetPanel
              key="asset-panel"
              asset={open}
              pinned={cartIds.has(open.id)}
              onTogglePin={toggleCart}
              onOpen={setOpen}
              onClose={closeAsset}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {STUDY.run && (
            <StudyRunner
              onFreshStart={() => {
                closeAsset();
                setCart([]);
                leaveThread();
              }}
            />
          )}
          {toast && (
            <motion.div
              key={toast.text}
              role="status"
              initial={{ opacity: 0, transform: "translate(-50%, 8px)" }}
              animate={{ opacity: 1, transform: "translate(-50%, 0px)" }}
              exit={{ opacity: 0, transform: "translate(-50%, 8px)" }}
              transition={tween.trayEnter}
              className={`fixed left-1/2 z-40 flex items-center gap-3 rounded-full bg-[var(--raised)] py-2 pr-2 pl-4 text-[13px] text-[var(--text)] shadow-[0_12px_40px_-12px_rgb(0_0_0/0.12)] ring-1 ring-[var(--hairline-strong)] ${cart.length > 0 ? "bottom-24" : "bottom-6"}`}
            >
              {toast.text}
              {toast.undo && (
                <button
                  type="button"
                  onClick={() => {
                    toast.undo?.();
                    setToast(null);
                  }}
                  className="pressable rounded-full px-2.5 py-1 font-medium text-[var(--accent)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.06]"
                >
                  Undo
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {open && narrow && (
            <AssetSheet
              key="asset-sheet"
              asset={open}
              pinned={cartIds.has(open.id)}
              onTogglePin={toggleCart}
              onOpen={setOpen}
              onClose={closeAsset}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
