import { useState } from "react";
import { SORTS, type Sort } from "../intent";

const KEY = "suave-settings";

/** What an artist chose by hand last time, applied when a query doesn't say otherwise. */
export type Settings = { setSort: Sort };

const DEFAULTS: Settings = { setSort: "relevance" };

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      setSort: SORTS.includes(raw.setSort as Sort) ? (raw.setSort as Sort) : DEFAULTS.setSort,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(load);
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  return [settings, update] as const;
}
