import { useSyncExternalStore } from "react";
import type { Progress } from "./encoder.ts";
import type { Call, Reply } from "./worker.ts";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { done: (v: unknown) => void; fail: (e: Error) => void }>();
let progress: Progress | null = null;
const listeners = new Set<() => void>();

function connect(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    if ("progress" in data) {
      progress = data.progress;
      listeners.forEach((l) => l());
      return;
    }
    const waiting = pending.get(data.id);
    pending.delete(data.id);
    if ("error" in data) waiting?.fail(new Error(data.error));
    else waiting?.done(data.result);
  };
  return worker;
}

/** Runs a retrieval call in the worker. Aborting stops waiting for the answer; the worker still finishes it. */
export function call<T>(c: Call, signal?: AbortSignal): Promise<T> {
  const id = nextId++;
  return new Promise<T>((done, fail) => {
    if (signal?.aborted) return fail(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => {
      pending.delete(id);
      fail(new DOMException("Aborted", "AbortError"));
    });
    pending.set(id, { done: done as (v: unknown) => void, fail });
    connect().postMessage({ id, ...c });
  });
}

/** The search model's download while it is under way, null before and after. */
export function useModelDownload(enabled: boolean): Progress | null {
  return useSyncExternalStore(
    (l) => {
      if (!enabled) return () => {};
      connect();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (enabled ? progress : null),
  );
}
