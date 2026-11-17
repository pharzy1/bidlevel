/**
 * Minimum-cost assignment (Hungarian algorithm, Jonker-Volgenant potentials form).
 *
 * `cost` has n rows and m columns with n ≤ m. Returns, for each row, the column
 * it is assigned to. Runs in O(n² · m).
 */
export function minCostAssignment(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]!.length;
  if (m < n) throw new RangeError(`minCostAssignment needs at least as many columns (${m}) as rows (${n}).`);

  const INF = Number.POSITIVE_INFINITY;
  // 1-based arrays, column 0 is a sentinel.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0); // p[j] = row matched to column j
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]! > 0) result[p[j]! - 1] = j - 1;
  return result;
}
