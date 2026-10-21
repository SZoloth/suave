import json, random

import pathlib
APP = pathlib.Path(__file__).resolve().parents[2]
fits = json.load(open(f"{APP}/eval/results/clef-membership.json"))
queries = json.load(open(f"{APP}/eval/membership.json"))["queries"]
groups = {g["about"]: g for g in queries.values() if g.get("reviewedAt")}

def items(v):
    out = []
    for about, g in groups.items():
        order = [c["id"] for c in g["candidates"]]
        last_pos = max((i for i, a in enumerate(order) if g["labels"].get(a)), default=-1)
        for rank, aid in enumerate(order):
            y = g["labels"].get(aid)
            s = fits[v].get(about, {}).get(aid)
            if y is None or s is None:
                continue
            out.append({"q": about, "s": s, "y": bool(y), "hard": (not y) and rank < last_pos})
    return out

def pr(xs, cut):
    tp = sum(x["s"] >= cut and x["y"] for x in xs)
    fp = sum(x["s"] >= cut and not x["y"] for x in xs)
    fn = sum(x["s"] < cut and x["y"] for x in xs)
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0), fp, fn

CUTS = [i / 100 for i in range(1, 100)]
def tune(xs):
    ok = [c for c in CUTS if min(pr(xs, c)[:2]) >= 0.8]
    return max(ok or CUTS, key=lambda c: pr(xs, c)[2])

for v in fits:
    xs = items(v)
    p, r, f, fp, fn = pr(xs, 0.5)
    hard = [x for x in xs if x["hard"]]
    hard_fp = sum(x["s"] >= 0.5 for x in hard)
    print(f"\n== {v}: {len(xs)} pairs, {sum(x['y'] for x in xs)} fit, {len(hard)} hard negatives")
    print(f"  at 0.50: {fp + fn} mistakes ({fp} wrong, {fn} missing); hard negatives let in {hard_fp} of {len(hard)}")
    held, cuts = [], []
    for q in groups:
        train = [x for x in xs if x["q"] != q]
        test = [x for x in xs if x["q"] == q]
        c = tune(train); cuts.append(c)
        held += [dict(x, pred=x["s"] >= c) for x in test]
    tp = sum(x["pred"] and x["y"] for x in held); fpn = sum(x["pred"] and not x["y"] for x in held); fnn = sum(not x["pred"] and x["y"] for x in held)
    P, R = tp / (tp + fpn), tp / (tp + fnn)
    rng = random.Random(7); qs = list(groups); boots = []
    for _ in range(2000):
        pick = [rng.choice(qs) for _ in qs]
        b = [x for q in pick for x in held if x["q"] == q]
        t = sum(x["pred"] and x["y"] for x in b); a = sum(x["pred"] and not x["y"] for x in b); m = sum(not x["pred"] and x["y"] for x in b)
        boots.append((t / (t + a) if t + a else 1, t / (t + m) if t + m else 1))
    lo = lambda i: sorted(b[i] for b in boots)[50]
    hi = lambda i: sorted(b[i] for b in boots)[1949]
    print(f"  leave-one-search-out: P {P:.2f} [{lo(0):.2f}-{hi(0):.2f}]  R {R:.2f} [{lo(1):.2f}-{hi(1):.2f}]  cutoffs chosen {min(cuts):.2f}-{max(cuts):.2f}")
    worst = []
    for q in groups:
        t = [x for x in held if x["q"] == q]
        a = sum(x["pred"] and not x["y"] for x in t); m = sum(not x["pred"] and x["y"] for x in t)
        worst.append((a + m, q, a, m, sum(x["y"] for x in t)))
    print("  per search (mistakes: wrong/missing of fit): " + ", ".join(f"{q} {a}/{m} of {n}" for k, q, a, m, n in sorted(worst, reverse=True) if k))

print("\n== Jev >= 0.50 AND Clef text >= c (c tuned leave-one-search-out)")
jev, clef = items("Jev"), items("Clef text")
assert [x["y"] for x in jev] == [x["y"] for x in clef]
both = [dict(j, c=c["s"]) for j, c in zip(jev, clef)]
def rule(xs, c): return [dict(x, s=1.0 if x["s"] >= 0.5 and x["c"] >= c else 0.0) for x in xs]
LOW = [i / 1000 for i in range(0, 300, 5)]
held, picked = [], []
for q in groups:
    train = [x for x in both if x["q"] != q]
    c = max(LOW, key=lambda c: (pr(rule(train, c), 0.5)[2], -c)); picked.append(c)
    held += rule([x for x in both if x["q"] == q], c)
p, r, f, fp, fn = pr(held, 0.5)
hard = [x for x in held if x["hard"]]
print(f"  held-out: P {p:.2f} R {r:.2f} F1 {f:.2f}, {fp + fn} mistakes ({fp} wrong, {fn} missing); hard negatives let in {sum(x['s'] >= 0.5 for x in hard)} of {len(hard)}; c chosen {min(picked):.3f}-{max(picked):.3f}")
