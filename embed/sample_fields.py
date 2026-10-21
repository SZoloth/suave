"""Add sample Library fields the stand-in library has no source for.

show, assetType, visibility and lastModifiedBy are Library fields. assetType uses the two
Library types shown as environment assets: geometry ("Environment") and location
("Environment Assembly"); grouped assets (several objects modelled as one, from grouped.json)
are locations. lastModifiedBy ("Last Author") is one of the library's real authors.
approvalStatus is not in the Library schema; its values are a guess.
Every value is stable per asset id and listed in the asset's "synthetic" field.

Updates embed/index/metadata.json in place.
Usage: .venv/bin/python sample_fields.py
"""

import hashlib
import json
from pathlib import Path

INDEX = Path(__file__).parent / "index"
FIELDS = ["show", "assetType", "visibility", "approvalStatus", "lastModifiedBy"]
SHOWS = ["stonegarden", "nightshift", "lanternbay", "mosshollow"]


def unit(asset_id: str, salt: str) -> float:
    return int(hashlib.sha256(f"{salt}:{asset_id}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def pick(u: float, weighted: list[tuple[str, float]]) -> str:
    for value, weight in weighted:
        if u < weight:
            return value
        u -= weight
    return weighted[-1][0]


def main() -> None:
    meta = json.loads((INDEX / "metadata.json").read_text())
    grouped_path = INDEX / "grouped.json"
    grouped = json.loads(grouped_path.read_text()) if grouped_path.exists() else {}
    authors = sorted({name for m in meta.values() for name in (m.get("author") or "").split(", ") if name})
    for asset_id, m in meta.items():
        m["show"] = SHOWS[int(unit(asset_id, "show") * len(SHOWS))]
        m["assetType"] = "location" if (grouped.get(asset_id) or 0) >= 0.5 else "geometry"
        own = (m.get("author") or "").split(", ")[0]
        m["lastModifiedBy"] = own if own and unit(asset_id, "last") < 0.6 else authors[int(unit(asset_id, "lastpick") * len(authors))]
        m["visibility"] = pick(unit(asset_id, "visibility"), [("PERMIT", 0.92), ("HIDE", 0.08)])
        m["approvalStatus"] = pick(unit(asset_id, "status"), [("approved", 0.55), ("in_review", 0.25), ("wip", 0.2)])
        m["synthetic"] = sorted(set(m.get("synthetic", [])) | set(FIELDS))
    (INDEX / "metadata.json").write_text(json.dumps(meta, indent=1))
    counts = {f: {} for f in FIELDS}
    for m in meta.values():
        for f in FIELDS:
            counts[f][m[f]] = counts[f].get(m[f], 0) + 1
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
