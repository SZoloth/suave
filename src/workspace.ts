import type { Lens, Step } from "./thread.ts";

/**
 * A search opened this session. Its words rebuild it after a reload; `steps` is null until it has been run or replayed.
 */
export type OpenSearch = { kind: "search"; id: string; group: string; query: string; lines: string[]; steps: Step[] | null };

/** What else can be open on the canvas. Each opens at most once. */
export type Target = { kind: "collection"; collectionId: string } | { kind: "pinned" };

/** Everything open this session, listed in Today. Panes sharing a `group` show side by side. */
export type Pane = OpenSearch | ({ id: string; group: string } & Target);

/** `focus` is the pane id the prompt works on, or null for home. */
export type Workspace = { panes: Pane[]; focus: string | null };

export type WorkspaceAction =
  | { type: "start"; id: string; steps: Step[]; beside?: boolean }
  | { type: "add"; id: string; query: string; lines: string[]; beside?: boolean }
  | { type: "open"; id: string; target: Target; beside?: boolean }
  | { type: "loaded"; id: string; steps: Step[] }
  | { type: "push"; step: Step }
  | { type: "truncate"; keep: number }
  | { type: "relens"; lens: Lens }
  | { type: "focus"; id: string | null }
  | { type: "join"; id: string; into: string }
  | { type: "detach"; id: string }
  | { type: "remove"; id: string }
  | { type: "separate"; group: string };

export const emptyWorkspace: Workspace = { panes: [], focus: null };

const wordsOf = (steps: Step[]) => ({ query: steps[0].query, lines: steps.slice(1).map((s) => s.label) });

const sameTarget = (p: Pane, t: Target) => (t.kind === "collection" ? p.kind === "collection" && p.collectionId === t.collectionId : p.kind === t.kind);

export const focusedPane = (ws: Workspace): Pane | null => ws.panes.find((p) => p.id === ws.focus) ?? null;

export const focusedSearch = (ws: Workspace): OpenSearch | null => {
  const p = focusedPane(ws);
  return p?.kind === "search" ? p : null;
};

/** The panes sharing the focused pane's group, in the order they joined. */
export const focusedGroup = (ws: Workspace): Pane[] => {
  const f = focusedPane(ws);
  return f ? ws.panes.filter((p) => p.group === f.group) : [];
};

/** Today in the sidebar: one entry per group, in the order groups were started. */
export const groupsOf = (ws: Workspace): Pane[][] => {
  const order: string[] = [];
  for (const p of ws.panes) if (!order.includes(p.group)) order.push(p.group);
  return order.map((g) => ws.panes.filter((p) => p.group === g));
};

const editFocused = (ws: Workspace, edit: (s: OpenSearch) => OpenSearch): Workspace => {
  const f = focusedSearch(ws);
  return f ? { ...ws, panes: ws.panes.map((p) => (p.id === f.id ? edit(f) : p)) } : ws;
};

/** Focus another pane in the same group, or home, when `id` leaves the canvas. */
const refocus = (ws: Workspace, id: string, group: string): string | null => {
  if (ws.focus !== id) return ws.focus;
  return ws.panes.find((p) => p.group === group && p.id !== id)?.id ?? null;
};

const added = (ws: Workspace, pane: Pane, beside?: boolean): Workspace => {
  const group = (beside && focusedPane(ws)?.group) || pane.id;
  return { panes: [...ws.panes, { ...pane, group }], focus: pane.id };
};

export function workspaceReducer(ws: Workspace, a: WorkspaceAction): Workspace {
  switch (a.type) {
    case "start":
      return added(ws, { kind: "search", id: a.id, group: a.id, ...wordsOf(a.steps), steps: a.steps }, a.beside);
    case "add":
      return added(ws, { kind: "search", id: a.id, group: a.id, query: a.query, lines: a.lines, steps: null }, a.beside);
    case "open": {
      const open = ws.panes.find((p) => sameTarget(p, a.target));
      if (!open) return added(ws, { id: a.id, group: a.id, ...a.target }, a.beside);
      const f = focusedPane(ws);
      return a.beside && f && f.id !== open.id ? workspaceReducer(ws, { type: "join", id: open.id, into: f.id }) : { ...ws, focus: open.id };
    }
    case "loaded":
      return { ...ws, panes: ws.panes.map((p) => (p.id === a.id && p.kind === "search" ? { ...p, ...wordsOf(a.steps), steps: a.steps } : p)) };
    case "push":
      return editFocused(ws, (s) => {
        const steps = [...(s.steps ?? []), a.step];
        return { ...s, ...wordsOf(steps), steps };
      });
    case "truncate":
      return editFocused(ws, (s) => {
        const steps = (s.steps ?? []).slice(0, Math.max(1, a.keep));
        return { ...s, ...wordsOf(steps), steps };
      });
    case "relens":
      return editFocused(ws, (s) => (s.steps?.length ? { ...s, steps: [...s.steps.slice(0, -1), { ...s.steps[s.steps.length - 1], lens: a.lens }] } : s));
    case "focus":
      return { ...ws, focus: a.id };
    case "join": {
      const into = ws.panes.find((p) => p.id === a.into);
      if (!into || a.id === a.into) return ws;
      return { panes: ws.panes.map((p) => (p.id === a.id ? { ...p, group: into.group } : p)), focus: a.id };
    }
    case "detach": {
      const hit = ws.panes.find((p) => p.id === a.id);
      if (!hit || ws.panes.filter((p) => p.group === hit.group).length < 2) return ws;
      return { panes: ws.panes.map((p) => (p.id === a.id ? { ...p, group: p.id } : p)), focus: refocus(ws, a.id, hit.group) };
    }
    case "remove": {
      const hit = ws.panes.find((p) => p.id === a.id);
      if (!hit) return ws;
      return { panes: ws.panes.filter((p) => p.id !== a.id), focus: refocus(ws, a.id, hit.group) };
    }
    case "separate":
      return { ...ws, panes: ws.panes.map((p) => (p.group === a.group ? { ...p, group: p.id } : p)) };
    default: {
      const never: never = a;
      return never;
    }
  }
}

const KEY = "suave-workspace";

/** Keeps every open pane without results, so a reload rebuilds Today and replays only what gets shown. */
export function saveWorkspace(ws: Workspace) {
  if (ws.panes.length === 0) return sessionStorage.removeItem(KEY);
  const panes = ws.panes.map((p) => (p.kind === "search" ? { ...p, steps: null } : p));
  sessionStorage.setItem(KEY, JSON.stringify({ panes, focus: ws.focus }));
}

const str = (v: unknown): v is string => typeof v === "string";

function parsePane(raw: Record<string, unknown>): Pane | null {
  if (!str(raw.id)) return null;
  const base = { id: raw.id, group: str(raw.group) ? raw.group : raw.id };
  if (raw.kind === "collection" && str(raw.collectionId)) return { ...base, kind: "collection", collectionId: raw.collectionId };
  if (raw.kind === "pinned") return { ...base, kind: "pinned" };
  if ((raw.kind === "search" || raw.kind === undefined) && str(raw.query) && Array.isArray(raw.lines))
    return { ...base, kind: "search", query: raw.query, lines: raw.lines.filter(str), steps: null };
  return null;
}

export function restoreWorkspace(): Workspace {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { panes?: unknown; searches?: unknown; focus?: unknown } | null;
    const list = raw?.panes ?? raw?.searches;
    if (!Array.isArray(list)) return emptyWorkspace;
    const panes = list.flatMap((p) => (p && typeof p === "object" ? [parsePane(p as Record<string, unknown>)].filter((x): x is Pane => x != null) : []));
    const focus = str(raw?.focus) && panes.some((p) => p.id === raw.focus) ? raw.focus : null;
    return { panes, focus };
  } catch {
    return emptyWorkspace;
  }
}
