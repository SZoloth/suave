/**
 * embed/server.py's search, ported so it can run in the browser: semantic ranking over the index
 * vectors, BM25 keyword ranking, metadata filters, typo correction, similar and complements.
 * `npm test` checks it against the server's own answers in embed/index/parity.json.
 */
import type { Asset, Filters, SearchResult, Space } from "../api.ts";

type Raw = Omit<Asset, "score">;
export type IndexFiles = {
  assets: Raw[];
  metadata: Record<string, Partial<Raw>>;
  grouped: Record<string, number>;
  collections: { id: string; name: string; assetIds: string[]; lastModifiedAt: string }[];
  english: Record<string, number>;
  spaces: Record<Space, Float32Array>;
};
export type SearchBody = { query: string; space?: Space; k?: number; exact?: boolean } & Filters;
export type SimilarBody = { ids: string[]; space?: Space; k?: number; complement?: boolean };
export type Encode = (text: string) => Promise<Float32Array>;

const DIM = 768;
const FIELDS = ["show", "assetType", "visibility", "approvalStatus"] as const;

/** A float32 C-order matrix from a .npy file. */
export function parseNpy(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const headerLength = view.getUint16(8, true);
  const header = new TextDecoder().decode(new Uint8Array(buffer, 10, headerLength));
  if (!header.includes("'<f4'") || header.includes("'fortran_order': True")) throw new Error(`unsupported .npy header ${header}`);
  return new Float32Array(buffer.slice(10 + headerLength));
}

const tokens = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((t) => (t.length > 3 ? t.replace(/s+$/, "") : t));
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** BM25 over name, categories and tags: a stand-in for metadata-only search. */
class Keyword {
  private docs: Map<string, number>[];
  private lens: number[];
  private avg: number;
  private idf = new Map<string, number>();
  private k1 = 1.2;
  private b = 0.75;

  constructor(docs: string[][]) {
    this.docs = docs.map((d) => d.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>()));
    this.lens = docs.map((d) => d.length);
    this.avg = this.lens.reduce((s, n) => s + n, 0) / docs.length;
    const df = new Map<string, number>();
    for (const d of this.docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    for (const [t, f] of df) this.idf.set(t, Math.log(1 + (docs.length - f + 0.5) / (f + 0.5)));
  }

  scores(query: string): Float32Array {
    const out = new Float32Array(this.docs.length);
    for (const t of new Set(tokens(query))) {
      const idf = this.idf.get(t);
      if (idf === undefined) continue;
      this.docs.forEach((d, i) => {
        const f = d.get(t);
        if (f) out[i] += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lens[i]) / this.avg));
      });
    }
    return out;
  }
}

const COMMON_ENGLISH = 2.5;
const CATALOG_BONUS = 1.5;
const JOIN_MARGIN = 1.0;

/** Optimal string alignment distance, so a swapped pair of letters costs one edit. */
export function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i, ...new Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] !== b[j - 1] ? 1 : 0;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
    }
    if (Math.min(...cur) > limit) return limit + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Typo correction against the catalog's own vocabulary. A word is corrected only when neither the
 * catalog nor everyday English knows it, and only to a catalog word one edit away (two for long words).
 */
class Speller {
  private counts: Map<string, number>;
  private english: Record<string, number>;

  constructor(counts: Map<string, number>, english: Record<string, number>) {
    this.counts = counts;
    this.english = english;
  }

  private zipf = (word: string) => this.english[word] ?? 0;
  private known = (word: string) => this.counts.has(word) || this.zipf(word) >= COMMON_ENGLISH;
  private strength = (word: string) => this.zipf(word) + (this.counts.has(word) ? CATALOG_BONUS : 0);

  /** Undo a stray space ("cand y", "barr el") when the joined word clearly beats its weaker half. */
  private rejoin(words: string[]): string[] {
    const out: string[] = [];
    const alpha = /^\p{L}+$/u;
    for (const word of words) {
      const last = out.at(-1);
      if (last && alpha.test(last) && alpha.test(word)) {
        const joined = last + word;
        if (this.known(joined) && this.strength(joined) > Math.min(this.strength(last), this.strength(word)) + JOIN_MARGIN) {
          out[out.length - 1] = joined;
          continue;
        }
      }
      out.push(word);
    }
    return out;
  }

  private fix(word: string): string {
    if (word.length < 3 || this.known(word)) return word;
    const limit = word.length <= 6 ? 1 : 2;
    let best: { key: [number, number, number]; cand: string } | null = null;
    for (const [cand, freq] of this.counts) {
      const d = distance(word, cand, limit);
      if (d > limit) continue;
      const key: [number, number, number] = [d, cand[0] !== word[0] ? 1 : 0, -freq];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) best = { key, cand };
    }
    return best?.cand ?? word;
  }

  correct(query: string): string {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const fixed = this.rejoin(words).join(" ").replace(/[a-z]+/g, (w) => this.fix(w));
    return fixed === words.join(" ") ? query : fixed;
  }
}

export class Catalog {
  readonly assets: Raw[];
  private byId: Map<string, number>;
  private keyword: Keyword;
  private speller: Speller;
  private files: IndexFiles;

  constructor(files: IndexFiles) {
    this.files = files;
    this.assets = files.assets.map((a) => ({ ...a, ...files.metadata[a.id], grouped: files.grouped[a.id], name: a.name.replaceAll("_", " ") }));
    this.byId = new Map(this.assets.map((a, i) => [a.id, i]));
    this.keyword = new Keyword(this.assets.map((a) => tokens([a.name, ...a.categories, ...a.tags].join(" "))));
    const counts = new Map<string, number>();
    const text = this.assets.map((a) => [a.name, ...a.categories, ...a.collections, ...a.tags, a.description ?? ""].join(" ")).join(" ");
    for (const w of text.toLowerCase().replaceAll("_", " ").match(/[a-z]+/g) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
    this.speller = new Speller(counts, files.english);
  }

  /** Metadata filters applied before ranking, so a filter never empties a top-k. Hidden assets stay in results and the card says so: a fitting asset never silently vanishes. */
  private where(body: Filters): boolean[] {
    return this.assets.map(
      (a) =>
        (!body.author || (a.author ?? "").split(", ").includes(body.author)) &&
        (!body.modifiedSince || (a.lastModifiedAt ?? "") >= body.modifiedSince) &&
        FIELDS.every((field) => !body[field] || a[field] === body[field]),
    );
  }

  private ranked(scores: ArrayLike<number>, k: number, exclude: Set<number> = new Set(), floor?: number): Asset[] {
    const order = Array.from(scores, (_, i) => i).sort((x, y) => scores[y] - scores[x]);
    const out: Asset[] = [];
    for (const i of order) {
      if (exclude.has(i)) continue;
      if (floor !== undefined && scores[i] <= floor) break;
      out.push({ ...this.assets[i], score: round4(scores[i]) });
      if (out.length === k) break;
    }
    return out;
  }

  private dots(space: Float32Array, q: ArrayLike<number>): Float64Array {
    const out = new Float64Array(this.assets.length);
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      for (let j = 0; j < DIM; j++) s += space[i * DIM + j] * q[j];
      out[i] = s;
    }
    return out;
  }

  /** The words the vector should encode: corrected unless the search asked for exact words. */
  queryFor(body: SearchBody): string {
    const typed = body.query.trim();
    return body.exact || !typed ? typed : this.speller.correct(typed);
  }

  async search(body: SearchBody, encode: Encode): Promise<SearchResult> {
    const typed = body.query.trim();
    const k = body.k ?? 24;
    const keep = this.where(body);
    if (!typed) {
      const hits = this.assets.filter((_, i) => keep[i]).sort((a, b) => ((b.lastModifiedAt ?? "") > (a.lastModifiedAt ?? "") ? 1 : (b.lastModifiedAt ?? "") < (a.lastModifiedAt ?? "") ? -1 : 0));
      return { query: "", corrected: null, semantic: hits.slice(0, k).map((a) => ({ ...a, score: 1 })), keyword: [], ms: 0 };
    }
    const query = this.queryFor(body);
    const started = performance.now();
    const semantic = this.dots(this.files.spaces[body.space ?? "fused"], await encode(query)).map((s, i) => (keep[i] ? s : -Infinity));
    const keyword = this.keyword.scores(query).map((s, i) => (keep[i] ? s : 0));
    return {
      query: typed,
      corrected: query !== typed ? query : null,
      semantic: this.ranked(semantic, k, undefined, -Infinity),
      keyword: this.ranked(keyword, k, undefined, 0),
      ms: Math.round(performance.now() - started),
    };
  }

  similar(body: SimilarBody): { results: Asset[] } {
    const idx = body.ids.flatMap((id) => this.byId.get(id) ?? []);
    if (idx.length === 0) return { results: [] };
    const space = this.files.spaces[body.space ?? "fused"];
    const k = body.k ?? 12;
    const centroid = new Float64Array(DIM);
    for (const i of idx) for (let j = 0; j < DIM; j++) centroid[j] += space[i * DIM + j] / idx.length;
    const norm = Math.hypot(...centroid);
    const scores = this.dots(space, centroid.map((x) => x / norm));
    if (body.complement) return { results: this.complements(space, scores, idx, k) };
    const cats = new Set(idx.flatMap((i) => this.assets[i].categories));
    const boosted = scores.map((s, i) => s + (this.assets[i].categories.some((c) => cats.has(c)) ? 0.1 : 0));
    return { results: this.ranked(boosted, k, new Set(idx)) };
  }

  /** Related but varied: favour the cart's sets, then pick by maximal marginal relevance. */
  private complements(space: Float32Array, scores: Float64Array, idx: number[], k: number): Asset[] {
    const sets = new Set(idx.flatMap((i) => this.assets[i].collections));
    const boosted = scores.map((s, i) => s + (this.assets[i].collections.some((c) => sets.has(c)) ? 0.06 : 0));
    const pool = Array.from(boosted, (_, i) => i)
      .sort((x, y) => boosted[y] - boosted[x])
      .slice(0, 60)
      .filter((i) => !idx.includes(i));
    const pair = (i: number, j: number) => {
      let s = 0;
      for (let d = 0; d < DIM; d++) s += space[i * DIM + d] * space[j * DIM + d];
      return s;
    };
    const chosen: number[] = [];
    while (pool.length > 0 && chosen.length < k) {
      const mmr = (i: number) => 0.75 * boosted[i] - 0.25 * Math.max(...[...chosen, ...idx].map((j) => pair(i, j)));
      const best = pool.reduce((a, b) => (mmr(b) > mmr(a) ? b : a));
      chosen.push(best);
      pool.splice(pool.indexOf(best), 1);
    }
    return chosen.map((i) => ({ ...this.assets[i], score: round4(scores[i]) }));
  }

  collections() {
    return this.files.collections.map((c) => ({ ...c, assets: c.assetIds.flatMap((id) => (this.byId.has(id) ? [this.assets[this.byId.get(id)!]] : [])) }));
  }
}
