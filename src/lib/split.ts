export const equalShares = (n: number) => Array.from({ length: n }, () => 1 / n);

/** Moves the edge between panes `i` and `i + 1` by `delta` (a share of the row), keeping both at least `min`. */
export function resize(shares: number[], i: number, delta: number, min: number): number[] {
  const pair = shares[i] + shares[i + 1];
  const left = Math.min(Math.max(shares[i] + delta, min), pair - min);
  return shares.map((s, j) => (j === i ? left : j === i + 1 ? pair - left : s));
}
