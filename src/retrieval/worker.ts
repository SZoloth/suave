/// <reference lib="webworker" />
import { Catalog, type IndexFiles, type SearchBody, type SimilarBody, parseNpy } from "./catalog.ts";
import { type Progress, loadEncoder } from "./encoder.ts";

export type Call = { op: "search"; body: SearchBody } | { op: "similar"; body: SimilarBody } | { op: "collections" } | { op: "health" };
export type Reply = { id: number; result: unknown } | { id: number; error: string } | { progress: Progress | null };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const at = (file: string) => new URL(`/retrieval/${file}`, scope.location.origin);
const fetched = async (file: string) => {
  const res = await fetch(at(file));
  if (!res.ok) throw new Error(`${file} ${res.status}`);
  return res;
};
const json = async <T>(file: string) => (await fetched(file)).json() as Promise<T>;
const npy = async (file: string) => parseNpy(await (await fetched(file)).arrayBuffer());

const catalog = (async () => {
  const [assets, metadata, grouped, collections, english, fused, text, image] = await Promise.all([
    json<IndexFiles["assets"]>("assets.json"),
    json<IndexFiles["metadata"]>("metadata.json"),
    json<IndexFiles["grouped"]>("grouped.json"),
    json<IndexFiles["collections"]>("collections.json"),
    json<IndexFiles["english"]>("english.json"),
    npy("fused.npy"),
    npy("text.npy"),
    npy("image.npy"),
  ]);
  return new Catalog({ assets, metadata, grouped, collections, english, spaces: { fused, text, image } });
})();

/** The first encode compiles GPU shaders for about 10s, so keep the download note up through it. */
const encoder = loadEncoder((progress) => scope.postMessage({ progress } satisfies Reply))
  .then(async (e) => (await e.encode("warm up"), e))
  .finally(() => scope.postMessage({ progress: null } satisfies Reply));
/** One encode at a time, as on the server. */
let queue: Promise<unknown> = Promise.resolve();
const encode = (text: string) => {
  const next = queue.then(async () => (await encoder).encode(text));
  queue = next.catch(() => {});
  return next;
};

async function run(call: Call): Promise<unknown> {
  const c = await catalog;
  switch (call.op) {
    case "search":
      return c.search(call.body, encode);
    case "similar":
      return c.similar(call.body);
    case "collections":
      return c.collections();
    case "health":
      return { assets: c.assets.length };
    default: {
      const never: never = call;
      throw new Error(`unknown call ${JSON.stringify(never)}`);
    }
  }
}

scope.onmessage = ({ data }: MessageEvent<{ id: number } & Call>) => {
  run(data).then(
    (result) => scope.postMessage({ id: data.id, result } satisfies Reply),
    (err) => scope.postMessage({ id: data.id, error: err instanceof Error ? err.message : String(err) } satisfies Reply),
  );
};
