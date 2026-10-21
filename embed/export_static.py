"""Writes what browser retrieval needs beyond the index itself.

index/english.json  everyday English word frequencies (zipf >= 1.5) for typo correction
index/parity.json   server answers for a spread of requests, with each query's vector, so
                    src/retrieval tests can check the TypeScript port against this server

Usage: .venv/bin/python export_static.py
"""

import json
import re

from wordfreq import iter_wordlist, zipf_frequency

import server
from model import query_text

MIN_ZIPF = 1.5

SEARCHES = [
    {"query": "wooden chair"},
    {"query": "chiar"},
    {"query": "barr el"},
    {"query": "wodden table", "k": 10},
    {"query": "something to sit on outside", "space": "text"},
    {"query": "mossy rocks", "space": "image"},
    {"query": "lamp", "exact": True},
    {"query": "chairs", "author": "Kirill Sannikov"},
    {"query": "props", "show": "stonegarden", "approvalStatus": "approved"},
    {"query": "rocks", "visibility": "HIDE"},
    {"query": "barrel", "assetType": "location", "modifiedSince": "2025-01-01"},
    {"query": "", "show": "nightshift", "k": 12},
    {"query": "  ", "approvalStatus": "in_review"},
]
SIMILAR = [
    {"ids": ["ArmChair_01", "Barrel_01"], "k": 8},
    {"ids": ["Barrel_01"], "space": "fused", "k": 6, "complement": True},
]


def english() -> dict[str, float]:
    words = (w for w in iter_wordlist("en") if re.fullmatch(r"[a-z]+", w))
    return {w: z for w in words if (z := round(zipf_frequency(w, "en"), 2)) >= MIN_ZIPF}


def parity() -> dict:
    ids = {a["id"] for a in server.assets}
    missing = [i for s in SIMILAR for i in s["ids"] if i not in ids]
    if missing:
        raise SystemExit(f"parity ids not in the index: {missing}")
    searches = []
    for body in SEARCHES:
        typed = body["query"].strip()
        query = typed if body.get("exact") or not typed else server.speller.correct(typed)
        vector = server.model.encode(query_text(query), normalize_embeddings=True).tolist() if typed else None
        searches.append({"body": body, "vector": vector, "answer": server.search(body)})
    return {"searches": searches, "similar": [{"body": b, "answer": server.similar(b)} for b in SIMILAR]}


if __name__ == "__main__":
    (server.INDEX / "english.json").write_text(json.dumps(english(), separators=(",", ":")))
    (server.INDEX / "parity.json").write_text(json.dumps(parity()))
    print("wrote english.json and parity.json")
