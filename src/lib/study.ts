/**
 * Moderated layout study. `?study=1` logs search, results and pick events with timestamps; `layout=plain` shows every
 * search as one plain grid with no router-chosen view or grouping, while retrieval stays the same.
 * `router=local` takes view and count from the local router instead of Jev; everything else stays Jev's.
 * The moderator exports the log from the console with `suaveStudy.export()` and clears it with `suaveStudy.clear()`.
 * `suaveStudy.task("T03")` marks where a task starts; `suaveStudy.task("T07", "plain")` also reloads into that arm,
 * so a fresh screen starts the task and the log keeps going.
 * `run=P1` replaces the console with the study runner tray, which walks that participant's schedule.
 */
export type Layout = "routed" | "plain";
export type Router = "jev" | "local";
export type StudyEvent = { at: string; type: "session" | "task" | "verdict" | "pick" | "note" | "preference" | "own" | "search" | "results" | "view" | "open" | "cart"; layout: Layout; router: Router } & Record<string, unknown>;

const KEY = "suave-study-log";
const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);

export const STUDY = {
  on: params.get("study") === "1",
  layout: (params.get("layout") === "plain" ? "plain" : "routed") as Layout,
  router: (params.get("router") === "local" ? "local" : "jev") as Router,
  run: params.get("study") === "1" ? params.get("run") : null,
};

export const STUDY_CHANGED = "suave-study-changed";

export const readStudy = (): StudyEvent[] => JSON.parse(localStorage.getItem(KEY) ?? "[]");

export function logStudy(type: StudyEvent["type"], data: Record<string, unknown> = {}) {
  if (!STUDY.on) return;
  localStorage.setItem(KEY, JSON.stringify([...readStudy(), { at: new Date().toISOString(), type, layout: STUDY.layout, router: STUDY.router, ...data }]));
  window.dispatchEvent(new Event(STUDY_CHANGED));
}

export function downloadStudy(name = `suave-study-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(readStudy(), null, 1)], { type: "application/json" }));
  a.download = name;
  a.click();
  return name;
}

if (STUDY.on && typeof window !== "undefined") {
  Object.assign(window, {
    suaveStudy: {
      export: () => downloadStudy(),
      clear: () => localStorage.removeItem(KEY),
      task(id: string, layout?: Layout) {
        logStudy("task", { task: id, ...(layout && { arm: layout }) });
        if (!layout || layout === STUDY.layout) return;
        const url = new URL(location.href);
        url.searchParams.set("layout", layout);
        location.assign(url);
      },
    },
  });
}
