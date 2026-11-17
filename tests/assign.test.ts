import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { minCostAssignment } from '../src/core/assign.ts';

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function bruteForce(cost: number[][]): number {
  const n = cost.length;
  const m = cost[0]!.length;
  let best = Infinity;
  const used = new Array<boolean>(m).fill(false);
  const go = (i: number, sum: number) => {
    if (i === n) {
      best = Math.min(best, sum);
      return;
    }
    for (let j = 0; j < m; j++) {
      if (used[j]) continue;
      used[j] = true;
      go(i + 1, sum + cost[i]![j]!);
      used[j] = false;
    }
  };
  go(0, 0);
  return best;
}

describe('minCostAssignment', () => {
  it('matches brute force on random rectangular matrices', () => {
    const rand = rng(42);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 5);
      const m = n + Math.floor(rand() * 3);
      const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.round((rand() * 200 - 100) * 10) / 10));
      const assignment = minCostAssignment(cost);
      assert.equal(new Set(assignment).size, n, 'columns are used at most once');
      const total = assignment.reduce((s, j, i) => s + cost[i]![j]!, 0);
      assert.ok(Math.abs(total - bruteForce(cost)) < 1e-6, `trial ${trial}`);
    }
  });

  it('handles the empty matrix and rejects too few columns', () => {
    assert.deepEqual(minCostAssignment([]), []);
    assert.throws(() => minCostAssignment([[1], [2]]), RangeError);
  });
});
