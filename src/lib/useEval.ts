import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * A labeled check saved under eval/. Changes apply to the latest value, so a long run can't overwrite labels
 * edited while it was going. Saves are debounced and flushed when the view unmounts or the page hides.
 */
export function useEval<T>(name: "membership" | "threads", fallback: T) {
  const [data, setData] = useState<T | null>(null);
  const latest = useRef<T | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    if (timer.current === undefined || !latest.current) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    api.saveEval(name, latest.current);
  }, [name]);

  useEffect(() => {
    api.loadEval<T>(name).then((d) => {
      latest.current ??= d ?? fallback;
      setData(latest.current);
    });
  }, [name]);

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const update = useCallback(
    (change: (prev: T) => T) => {
      if (!latest.current) return;
      latest.current = change(latest.current);
      setData(latest.current);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 300);
    },
    [flush],
  );

  return [data, update] as const;
}
