"""Typo correction against the catalog's own vocabulary.

A word is corrected only when neither the catalog nor everyday English knows it,
and only to a catalog word one edit away (two for long words). The English gate
matters because a small catalog lacks most real words ("party", "dog", "shirt").
"""

import re
from collections import Counter

from wordfreq import zipf_frequency

WORD = re.compile(r"[a-z]+")
COMMON_ENGLISH = 2.5
CATALOG_BONUS = 1.5
JOIN_MARGIN = 1.0


def distance(a: str, b: str, limit: int) -> int:
    """Optimal string alignment distance, so a swapped pair of letters costs one edit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev2, prev = None, list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = a[i - 1] != b[j - 1]
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        if min(cur) > limit:
            return limit + 1
        prev2, prev = prev, cur
    return prev[-1]


class Speller:
    def __init__(self, counts: Counter):
        self.counts = counts

    @classmethod
    def from_assets(cls, assets: list[dict]) -> "Speller":
        text = " ".join(
            " ".join([a["name"], *a["categories"], *a["collections"], *a["tags"], a.get("description", "")])
            for a in assets
        )
        return cls(Counter(WORD.findall(text.lower().replace("_", " "))))

    def known(self, word: str) -> bool:
        return word in self.counts or zipf_frequency(word, "en") >= COMMON_ENGLISH

    def strength(self, word: str) -> float:
        return zipf_frequency(word, "en") + (CATALOG_BONUS if word in self.counts else 0)

    def rejoin(self, words: list[str]) -> list[str]:
        """Undo a stray space ("cand y", "barr el") when the joined word clearly beats its weaker half."""
        out: list[str] = []
        for word in words:
            if out and out[-1].isalpha() and word.isalpha():
                joined = out[-1] + word
                if self.known(joined) and self.strength(joined) > min(map(self.strength, (out[-1], word))) + JOIN_MARGIN:
                    out[-1] = joined
                    continue
            out.append(word)
        return out

    def fix(self, word: str) -> str:
        if len(word) < 3 or self.known(word):
            return word
        limit = 1 if len(word) <= 6 else 2
        best = None
        for cand, freq in self.counts.items():
            d = distance(word, cand, limit)
            if d <= limit:
                key = (d, cand[0] != word[0], -freq)
                if best is None or key < best[0]:
                    best = (key, cand)
        return best[1] if best else word

    def correct(self, query: str) -> str:
        words = query.lower().split()
        fixed = WORD.sub(lambda m: self.fix(m.group()), " ".join(self.rejoin(words)))
        return query if fixed == " ".join(words) else fixed
