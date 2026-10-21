import { useEffect, useState } from "react";
import { api } from "../api";

const KEY = "suave:thread-titles";
const MAX = 200;

const load = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

/** The plain-English title for a thread of two or more lines, or null while it's written (or if it can't be). Remembered across reloads. */
export function useThreadTitle(lines: string[]): string | null {
  const key = lines.length > 1 ? lines.join("\n").toLowerCase() : "";
  const [titles, setTitles] = useState(load);
  const known = key ? (titles[key] ?? null) : null;

  useEffect(() => {
    if (!key || known) return;
    const ctrl = new AbortController();
    api
      .title(lines, ctrl.signal)
      .then((title) => {
        if (!title) return;
        setTitles((all) => {
          const next = Object.fromEntries([...Object.entries({ ...all, [key]: title })].slice(-MAX));
          localStorage.setItem(KEY, JSON.stringify(next));
          return next;
        });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [key, known]);

  return known;
}
