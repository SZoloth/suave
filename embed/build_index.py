"""Build the stand-in asset index: Poly Haven CC0 models embedded with EmbeddingGemma 2.

Writes embed/index/:
  assets.json      asset metadata (name, categories, tags, description, dimensions)
  thumbs/<id>.png  256px thumbnails
  text.npy         text-only embeddings (name + tags + description)
  image.npy        thumbnail-only embeddings
  fused.npy        interleaved text + thumbnail embeddings

Usage: .venv/bin/python build_index.py [--limit N]
"""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

from model import doc_text, load_model

INDEX = Path(__file__).parent / "index"
THUMBS = INDEX / "thumbs"
API = "https://api.polyhaven.com/assets?t=models"
THUMB_URL = "https://cdn.polyhaven.com/asset_img/thumbs/{id}.png?width=256&height=256"


def fetch_assets(limit: int | None) -> list[dict]:
    raw = requests.get(API, timeout=30).json()
    assets = []
    for asset_id, a in sorted(raw.items()):
        assets.append(
            {
                "id": asset_id,
                "name": a["name"],
                "categories": [c for c in a.get("categories", []) if not c.startswith("collection: ")],
                "collections": [c.removeprefix("collection: ") for c in a.get("categories", []) if c.startswith("collection: ")],
                "tags": a.get("tags", []),
                "description": (a.get("description") or "").strip(),
                "dimensions_mm": [round(d) for d in a.get("dimensions", [])],
            }
        )
    return assets[:limit] if limit else assets


def fetch_thumb(asset_id: str) -> None:
    path = THUMBS / f"{asset_id}.png"
    if path.exists():
        return
    r = requests.get(THUMB_URL.format(id=asset_id), timeout=30)
    r.raise_for_status()
    path.write_bytes(r.content)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--batch", type=int, default=16)
    args = parser.parse_args()

    THUMBS.mkdir(parents=True, exist_ok=True)
    assets = fetch_assets(args.limit)
    print(f"{len(assets)} assets")
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(fetch_thumb, [a["id"] for a in assets]))
    (INDEX / "assets.json").write_text(json.dumps(assets, indent=1))

    model = load_model()
    texts = [doc_text(a) for a in assets]
    images = [str(THUMBS / f"{a['id']}.png") for a in assets]

    def encode(inputs):
        return model.encode(inputs, batch_size=args.batch, normalize_embeddings=True, show_progress_bar=True)

    np.save(INDEX / "text.npy", encode(texts).astype(np.float32))
    np.save(INDEX / "image.npy", encode([{"image": p} for p in images]).astype(np.float32))
    np.save(INDEX / "fused.npy", encode([{"text": f"{t} <|image|>", "image": [p]} for t, p in zip(texts, images)]).astype(np.float32))
    print(f"wrote {INDEX}")


if __name__ == "__main__":
    main()
