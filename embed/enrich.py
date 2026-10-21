"""Add Library-shaped metadata to the stand-in index, keyed by asset id.

Field names follow the Library asset schema (author, createdAt, lastModifiedAt).
author and createdAt are real Poly Haven values (authors, date_published).
Poly Haven has no edit history, so lastModifiedAt is a stable sample date between
createdAt and SAMPLE_NOW, listed in each asset's "synthetic" field.

Writes embed/index/metadata.json.
Usage: .venv/bin/python enrich.py
"""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests

INDEX = Path(__file__).parent / "index"
INFO = "https://api.polyhaven.com/info/{id}"
SAMPLE_NOW = datetime(2026, 10, 13, 17, tzinfo=timezone.utc)


def iso(ts: float) -> str:
    return datetime.fromtimestamp(int(ts), timezone.utc).isoformat().replace("+00:00", "Z")


def sample_modified(asset_id: str, created: float) -> float:
    u = int(hashlib.sha256(asset_id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    span = SAMPLE_NOW.timestamp() - created
    return SAMPLE_NOW.timestamp() - span * u**3


def enrich(asset_id: str) -> tuple[str, dict]:
    info = requests.get(INFO.format(id=asset_id), timeout=30).json()
    created = float(info["date_published"])
    return asset_id, {
        "author": ", ".join(info.get("authors", {})) or None,
        "createdAt": iso(created),
        "lastModifiedAt": iso(sample_modified(asset_id, created)),
        "synthetic": ["lastModifiedAt"],
    }


def main() -> None:
    ids = [a["id"] for a in json.loads((INDEX / "assets.json").read_text())]
    with ThreadPoolExecutor(12) as pool:
        meta = dict(pool.map(enrich, ids))
    (INDEX / "metadata.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {len(meta)} records to {INDEX / 'metadata.json'}")


if __name__ == "__main__":
    main()
