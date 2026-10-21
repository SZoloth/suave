"""Sample "existing Library collections" for the artist, built from the stand-in library.

The fake Library API can't list collections (its search route is shadowed), so the
retrieval server serves these instead. Each is a category on one sample show, the kind
of collection an artist keeps per show. Run after sample_fields.py.

Writes embed/index/collections.json.
Usage: .venv/bin/python sample_collections.py
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

INDEX = Path(__file__).parent / "index"
SAMPLE_NOW = datetime(2026, 10, 13, 17, tzinfo=timezone.utc)

# name, show, category, days since last change
SPECS = [
    ("Night Shift warehouse tools", "nightshift", "tools", 3),
    ("Stone Garden village furniture", "stonegarden", "furniture", 12),
    ("Lantern Bay tavern lighting", "lanternbay", "lighting", 26),
    ("Moss Hollow forest rocks", "mosshollow", "rocks", 58),
    ("Night Shift kitchen dressing", "nightshift", "dishes", 95),
]


def main() -> None:
    assets = json.loads((INDEX / "assets.json").read_text())
    meta = json.loads((INDEX / "metadata.json").read_text())
    out = []
    for name, show, category, days in SPECS:
        ids = sorted(a["id"] for a in assets if category in a["categories"] and meta[a["id"]].get("show") == show)
        changed = (SAMPLE_NOW - timedelta(days=days)).isoformat().replace("+00:00", "Z")
        out.append({"id": f"sample-{name.lower().replace(' ', '-')}", "name": name, "assetIds": ids, "lastModifiedAt": changed})
    (INDEX / "collections.json").write_text(json.dumps(out, indent=1))
    print("\n".join(f"{c['name']}: {len(c['assetIds'])}" for c in out))


if __name__ == "__main__":
    main()
