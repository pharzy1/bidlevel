import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concentrationCappedAward, lowestCostAward, singleSourceAwards, type AwardOptions } from '../src/core/award.ts';
import { level } from '../src/core/level.ts';
import type { BidLine, CatalogItem, LevelingResult } from '../src/core/types.ts';
import { loadSample } from './sample.ts';

const base: AwardOptions = { includeClarifications: true, maxLeadTimeWeeks: null, maxVendorShare: null };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A leveling result with only compliant cells at the given prices: prices[item][vendor]. */
function synthetic(prices: number[][]): LevelingResult {
  const vendors = prices[0]!.map((_, v) => `V${v}`);
  const catalog: CatalogItem[] = prices.map((_, i) => ({
    id: `I${i}`,
    line: i + 1,
    description: '',
    quantity: 1,
    uom: 'EA',
    required: { kind: 'meter' },
  }));
  const cells: LevelingResult['cells'] = {};
  prices.forEach((row, i) => {
    cells[`I${i}`] = {};
    row.forEach((price, v) => {
      if (price < 0) return;
      const bid: BidLine = { vendor: vendors[v]!, row: i + 1, buyerLineRef: null, description: '', quantity: 1, uomText: 'EA', unitPriceText: String(price), leadTimeText: '', noBid: false };
      cells[`I${i}`]![vendors[v]!] = {
        itemId: `I${i}`,
        vendor: vendors[v]!,
        bid,
        source: 'deterministic',
        score: 0,
        checks: [],
        price: { unitPrice: price, explanation: '' },
        extendedPrice: price,
        leadTimeWeeks: 4,
        flags: [],
        compliant: true,
      };
    });
  });
  return { catalog, vendors, cells, unresolved: [], noBids: [] };
}

function bruteForceCapped(prices: number[][], cap: number): number {
  let best = Infinity;
  const vendors = prices[0]!.length;
  const pick = (i: number, spend: number[], total: number) => {
    if (i === prices.length) {
      if (spend.every((s) => s <= cap * total + 1e-9)) best = Math.min(best, total);
      return;
    }
    for (let v = 0; v < vendors; v++) {
      const p = prices[i]![v]!;
      if (p < 0) continue;
      spend[v] = spend[v]! + p;
      pick(i + 1, spend, total + p);
      spend[v] = spend[v]! - p;
    }
  };
  pick(0, new Array<number>(vendors).fill(0), 0);
  return best;
}

describe('concentrationCappedAward', () => {
  it('matches brute force on random instances', () => {
    const rand = rng(7);
    for (let trial = 0; trial < 150; trial++) {
      const items = 2 + Math.floor(rand() * 6);
      const vendors = 2 + Math.floor(rand() * 2);
      const prices = Array.from({ length: items }, () => Array.from({ length: vendors }, () => (rand() < 0.15 ? -1 : Math.round(100 + rand() * 900))));
      // Every item needs at least one bid for the brute force to be comparable.
      prices.forEach((row) => {
        if (row.every((p) => p < 0)) row[0] = 500;
      });
      const cap = [0.4, 0.5, 0.6, 0.75][Math.floor(rand() * 4)]!;
      const scenario = concentrationCappedAward(synthetic(prices), { ...base, maxVendorShare: cap });
      const expected = bruteForceCapped(prices, cap);
      if (expected === Infinity) assert.ok(scenario.infeasible, `trial ${trial} should be infeasible`);
      else {
        assert.ok(scenario.optimal);
        assert.ok(Math.abs(scenario.total - expected) < 0.01, `trial ${trial}: got ${scenario.total}, expected ${expected}`);
        for (const s of scenario.shares) assert.ok(s.share <= cap + 1e-9);
      }
    }
  });

  it('says so when no award fits the cap', () => {
    const scenario = concentrationCappedAward(synthetic([[100, -1], [200, -1]]), { ...base, maxVendorShare: 0.5 });
    assert.ok(scenario.infeasible);
    assert.equal(scenario.awards.length, 0);
  });
});

describe('award scenarios on the sample', () => {
  const { catalog, bids } = loadSample();
  const result = level(catalog, bids);

  it('never awards a line to a deviating bid', () => {
    const lowest = lowestCostAward(result, base);
    for (const a of lowest.awards) {
      const cell = result.cells[a.itemId]![a.vendor]!;
      assert.ok(!cell.flags.some((f) => f.code === 'deviation'), `${a.itemId} went to ${a.vendor}`);
    }
    assert.equal(lowest.uncovered.length, 0);
  });

  it('excludes bids needing clarification when asked', () => {
    const strict = lowestCostAward(result, { ...base, includeClarifications: false });
    const a = strict.awards.find((x) => x.itemId === 'TX-OH1-50')!;
    assert.notEqual(a.vendor, 'Vendor B');
  });

  it('applies a lead-time limit, treating an unreadable lead time as ineligible', () => {
    const fast = lowestCostAward(result, { ...base, maxLeadTimeWeeks: 40 });
    const recloser = fast.awards.find((x) => x.itemId === 'RCL-15-630')!;
    assert.equal(recloser.vendor, 'Vendor B');
    assert.ok(fast.uncovered.includes('TX-PM3-1500'), 'every compliant 1500 kVA bid is quoted beyond 40 weeks');
  });

  it('caps concentration at a small premium over the lowest award', () => {
    const lowest = lowestCostAward(result, base);
    const capped = concentrationCappedAward(result, { ...base, maxVendorShare: 0.5 });
    assert.ok(lowest.shares[0]!.share > 0.5);
    assert.ok(capped.shares.every((s) => s.share <= 0.5));
    assert.ok(capped.total >= lowest.total);
  });

  it('shows which vendors can and cannot single-source', () => {
    const single = singleSourceAwards(result, base);
    assert.equal(single.find((s) => s.key === 'single:Vendor A')!.uncovered.length, 0);
    assert.ok(single.find((s) => s.key === 'single:Vendor B')!.uncovered.includes('MTR-2S'));
  });
});
