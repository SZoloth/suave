"""Local retrieval server for the stand-in index.

POST /search   {query, space: fused|text|image, k, exact?, author?, modifiedSince?, show?, assetType?, visibility?, approvalStatus?}  -> semantic + keyword results
POST /similar  {ids: [..], k}                        -> nearest neighbours of the ids' centroid
POST /route    {query}                               -> the local router's view and count, from router-heads.json
GET  /collections                                   -> the artist's sample Library collections, with assets
GET  /thumbs/<id>.png

Usage: .venv/bin/python server.py  (listens on 127.0.0.1:8765)
"""

import json
import os
import math
import re
import threading
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

from model import load_model, query_text
from spell import Speller

INDEX = Path(__file__).parent / "index"
PORT = int(os.environ.get("PORT", "8765"))
HOST = os.environ.get("HOST", "127.0.0.1")

metadata: dict[str, dict] = json.loads((INDEX / "metadata.json").read_text())
grouped_path = INDEX / "grouped.json"
grouped: dict[str, float] = json.loads(grouped_path.read_text()) if grouped_path.exists() else {}
assets: list[dict] = [
    {**a, **metadata[a["id"]], "grouped": grouped.get(a["id"]), "name": a["name"].replace("_", " ")}
    for a in json.loads((INDEX / "assets.json").read_text())
]
by_id = {a["id"]: i for i, a in enumerate(assets)}
collections_path = INDEX / "collections.json"
sample_collections: list[dict] = json.loads(collections_path.read_text()) if collections_path.exists() else []
spaces = {name: np.load(INDEX / f"{name}.npy") for name in ("fused", "text", "image")}
model = load_model()
heads_path = Path(__file__).parent / "router-heads.json"
router_heads = {
    h: (v["classes"], np.array(v["coef"]), np.array(v["intercept"])) for h, v in json.loads(heads_path.read_text())["heads"].items()
} if heads_path.exists() else {}
encode_lock = threading.Lock()

TOKEN = re.compile(r"[a-z0-9]+")
FIELDS = ("show", "assetType", "visibility", "approvalStatus")


def tokens(text: str) -> list[str]:
    return [t.rstrip("s") if len(t) > 3 else t for t in TOKEN.findall(text.lower())]


class Keyword:
    """BM25 over name, categories and tags: a stand-in for metadata-only search."""

    def __init__(self, docs: list[list[str]], k1: float = 1.2, b: float = 0.75):
        self.docs = [Counter(d) for d in docs]
        self.lens = [len(d) for d in docs]
        self.avg = sum(self.lens) / len(self.lens)
        df = Counter(t for d in self.docs for t in d)
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.k1, self.b = k1, b

    def scores(self, query: str) -> np.ndarray:
        out = np.zeros(len(self.docs), dtype=np.float32)
        for t in set(tokens(query)):
            idf = self.idf.get(t)
            if idf is None:
                continue
            for i, d in enumerate(self.docs):
                f = d.get(t)
                if f:
                    out[i] += idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.lens[i] / self.avg))
        return out


keyword = Keyword([tokens(" ".join([a["name"], *a["categories"], *a["tags"]])) for a in assets])
speller = Speller.from_assets(assets)


def where(body: dict) -> np.ndarray:
    """Metadata filters applied before ranking, so a filter never empties a top-k. Hidden assets stay in results and the card says so: a fitting asset never silently vanishes."""
    keep = np.ones(len(assets), dtype=bool)
    if author := body.get("author"):
        keep &= np.array([author in (a.get("author") or "").split(", ") for a in assets])
    if since := body.get("modifiedSince"):
        keep &= np.array([a["lastModifiedAt"] >= since for a in assets])
    for field in FIELDS:
        if value := body.get(field):
            keep &= np.array([a.get(field) == value for a in assets])
    return keep


def ranked(scores: np.ndarray, k: int, exclude: set[int] = frozenset(), floor: float | None = None) -> list[dict]:
    order = np.argsort(-scores)
    out = []
    for i in order:
        if i in exclude:
            continue
        if floor is not None and scores[i] <= floor:
            break
        out.append({**assets[i], "score": round(float(scores[i]), 4)})
        if len(out) == k:
            break
    return out


def browse(body: dict, k: int) -> dict:
    """No query: everything that passes the filters, most recently changed first."""
    hits = sorted((a for a, kept in zip(assets, where(body)) if kept), key=lambda a: a["lastModifiedAt"], reverse=True)
    return {"query": "", "corrected": None, "semantic": [{**a, "score": 1.0} for a in hits[:k]], "keyword": [], "ms": 0}


def search(body: dict) -> dict:
    typed = body["query"].strip()
    if not typed:
        return browse(body, int(body.get("k", 24)))
    query = typed if body.get("exact") else speller.correct(typed)
    k = int(body.get("k", 24))
    space = spaces[body.get("space", "fused")]
    started = time.perf_counter()
    with encode_lock:
        q = model.encode(query_text(query), normalize_embeddings=True)
    keep = where(body)
    semantic = ranked(np.where(keep, space @ q, -np.inf), k, floor=-np.inf)
    return {
        "query": typed,
        "corrected": query if query != typed else None,
        "semantic": semantic,
        "keyword": ranked(np.where(keep, keyword.scores(query), 0.0), k, floor=0.0),
        "ms": round((time.perf_counter() - started) * 1000),
    }


def similar(body: dict) -> dict:
    idx = [by_id[i] for i in body["ids"] if i in by_id]
    if not idx:
        return {"results": []}
    space = spaces[body.get("space", "fused")]
    k = int(body.get("k", 12))
    centroid = space[idx].mean(axis=0)
    centroid /= np.linalg.norm(centroid)
    scores = space @ centroid
    if not body.get("complement"):
        cats = {c for i in idx for c in assets[i]["categories"]}
        boosted = scores + np.array([0.1 if cats & set(a["categories"]) else 0.0 for a in assets])
        return {"results": ranked(boosted, k, exclude=set(idx))}
    return {"results": complements(space, scores, idx, k)}


def complements(space: np.ndarray, scores: np.ndarray, idx: list[int], k: int) -> list[dict]:
    """Related but varied: favour the cart's sets, then pick by maximal marginal relevance."""
    sets = {c for i in idx for c in assets[i]["collections"]}
    boosted = scores + np.array([0.06 if sets & set(a["collections"]) else 0.0 for a in assets])
    pool = [i for i in np.argsort(-boosted)[:60] if i not in idx]
    chosen: list[int] = []
    while pool and len(chosen) < k:
        def mmr(i: int) -> float:
            redundancy = max((float(space[i] @ space[j]) for j in chosen + idx), default=0.0)
            return 0.75 * float(boosted[i]) - 0.25 * redundancy
        best = max(pool, key=mmr)
        chosen.append(best)
        pool.remove(best)
    return [{**assets[i], "score": round(float(scores[i]), 4)} for i in chosen]


def warm(body: dict) -> dict:
    """The first encode after a second or more idle takes 3 to 5 times longer on MPS. Encoding the typed text while Jev reads it means the search that follows runs warm."""
    if encode_lock.acquire(blocking=False):
        try:
            model.encode(query_text(body.get("query", "")), normalize_embeddings=True)
        finally:
            encode_lock.release()
    return {}


def route(body: dict) -> dict:
    """Linear heads distilled from Claude's labels, over the same embedding retrieval uses. Softmax over each head's classes."""
    started = time.perf_counter()
    with encode_lock:
        x = model.encode(query_text(body["query"]), normalize_embeddings=True)
    out = {}
    for h, (classes, coef, intercept) in router_heads.items():
        z = coef @ x + intercept
        p = np.exp(z - z.max())
        p /= p.sum()
        out[h] = {"value": classes[int(p.argmax())], "confidence": round(float(p.max()), 4), "probabilities": dict(zip(classes, np.round(p, 4).tolist()))}
    return {"heads": out, "ms": round((time.perf_counter() - started) * 1000)}


ROUTES = {"/search": search, "/similar": similar, "/warm": warm, "/route": route}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            return self._send(200, json.dumps({"assets": len(assets)}).encode(), "application/json")
        if self.path == "/collections":
            listed = [{**c, "assets": [assets[by_id[i]] for i in c["assetIds"] if i in by_id]} for c in sample_collections]
            return self._send(200, json.dumps(listed).encode(), "application/json")
        m = re.fullmatch(r"/thumbs/([\w-]+)\.png", self.path)
        if m and (path := INDEX / "thumbs" / f"{m[1]}.png").exists():
            return self._send(200, path.read_bytes(), "image/png")
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        route = ROUTES.get(self.path)
        if not route:
            return self._send(404, b"not found", "text/plain")
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            self._send(200, json.dumps(route(body)).encode(), "application/json")
        except (KeyError, ValueError) as err:
            self._send(400, json.dumps({"error": str(err)}).encode(), "application/json")

    def log_message(self, fmt: str, *args) -> None:
        pass


if __name__ == "__main__":
    print(f"retrieval server on http://{HOST}:{PORT} ({len(assets)} assets)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
