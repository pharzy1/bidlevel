import { cellStatus } from './level.ts';
import type { LevelingResult } from './types.ts';

export interface AwardOptions {
  /** Let bids that need clarification (a requirement not stated) win. Deviations never do. */
  includeClarifications: boolean;
  /** Bids with a longer lead time are not eligible. Null for no limit. */
  maxLeadTimeWeeks: number | null;
  /** No vendor may receive more than this share of the total, e.g. 0.6. Null for no limit. */
  maxVendorShare: number | null;
}

export interface Award {
  itemId: string;
  vendor: string;
  extendedPrice: number;
}

export interface AwardScenario {
  key: string;
  title: string;
  description: string;
  awards: Award[];
  total: number;
  /** Catalog items no eligible bid covers. */
  uncovered: string[];
  shares: { vendor: string; amount: number; share: number }[];
  /** False when the search hit its node limit and the result is the best found, not proven best. */
  optimal: boolean;
  /** Set when no award satisfies the constraints. */
  infeasible?: string;
  /** A total no award under these rules can beat, when known. */
  lowerBound?: number;
}

export interface Option {
  vendor: string;
  price: number;
}

function eligibleOptions(result: LevelingResult, opts: AwardOptions): Map<string, Option[]> {
  const out = new Map<string, Option[]>();
  for (const item of result.catalog) {
    const options: Option[] = [];
    for (const vendor of result.vendors) {
      const cell = result.cells[item.id]?.[vendor];
      const status = cellStatus(cell);
      if (!cell || cell.extendedPrice === null) continue;
      if (status === 'deviation' || status === 'no_bid') continue;
      if (status === 'clarify' && !opts.includeClarifications) continue;
      // A bid that only lacks a stated requirement is still unpriceable if the price can't be read; handled above.
      if (opts.maxLeadTimeWeeks !== null && (cell.leadTimeWeeks === null || cell.leadTimeWeeks > opts.maxLeadTimeWeeks)) continue;
      options.push({ vendor, price: cell.extendedPrice });
    }
    out.set(item.id, options.sort((a, b) => a.price - b.price));
  }
  return out;
}

function summarize(
  key: string,
  title: string,
  description: string,
  awards: Award[],
  uncovered: string[],
  optimal: boolean,
): AwardScenario {
  const total = Math.round(awards.reduce((s, a) => s + a.extendedPrice, 0) * 100) / 100;
  const byVendor = new Map<string, number>();
  for (const a of awards) byVendor.set(a.vendor, (byVendor.get(a.vendor) ?? 0) + a.extendedPrice);
  const shares = [...byVendor.entries()]
    .map(([vendor, amount]) => ({ vendor, amount: Math.round(amount * 100) / 100, share: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { key, title, description, awards, total, uncovered, shares, optimal };
}

/** Cheapest eligible bid on every line, from whichever vendor offers it. */
export function lowestCostAward(result: LevelingResult, opts: AwardOptions): AwardScenario {
  const options = eligibleOptions(result, opts);
  const awards: Award[] = [];
  const uncovered: string[] = [];
  for (const item of result.catalog) {
    const best = options.get(item.id)?.[0];
    if (best) awards.push({ itemId: item.id, vendor: best.vendor, extendedPrice: best.price });
    else uncovered.push(item.id);
  }
  return summarize(
    'lowest',
    'Lowest cost, line by line',
    'Each line goes to its cheapest eligible bid. Usually the lowest total, but it can put most of the spend with one supplier.',
    awards,
    uncovered,
    true,
  );
}

/** Everything to one vendor: one scenario per vendor that has an eligible bid on every line. */
export function singleSourceAwards(result: LevelingResult, opts: AwardOptions): AwardScenario[] {
  const options = eligibleOptions(result, opts);
  return result.vendors.map((vendor) => {
    const awards: Award[] = [];
    const uncovered: string[] = [];
    for (const item of result.catalog) {
      const o = options.get(item.id)?.find((x) => x.vendor === vendor);
      if (o) awards.push({ itemId: item.id, vendor, extendedPrice: o.price });
      else uncovered.push(item.id);
    }
    return summarize(
      `single:${vendor}`,
      `Single source: ${vendor}`,
      uncovered.length === 0
        ? `Every line to ${vendor}. One contract, one delivery schedule.`
        : `${vendor} has no eligible bid on ${uncovered.length} line${uncovered.length === 1 ? '' : 's'}, so a single award to them can't cover the solicitation.`,
      awards,
      uncovered,
      true,
    );
  });
}

/**
 * Lowest total with no vendor above `maxShare` of the award, solved exactly by
 * branch and bound. Lines are taken most-expensive first so the bound tightens
 * early; the lower bound is the spend so far plus each remaining line's
 * cheapest option. Stops at `nodeLimit` and reports the best found.
 */
export function concentrationCappedAward(
  result: LevelingResult,
  opts: AwardOptions & { maxVendorShare: number },
  nodeLimit = 400_000,
): AwardScenario {
  const options = eligibleOptions(result, opts);
  const cap = opts.maxVendorShare;
  const items = result.catalog.filter((i) => (options.get(i.id)?.length ?? 0) > 0);
  const uncovered = result.catalog.filter((i) => (options.get(i.id)?.length ?? 0) === 0).map((i) => i.id);
  items.sort((a, b) => options.get(b.id)![0]!.price - options.get(a.id)![0]!.price);

  const minRest = new Array<number>(items.length + 1).fill(0);
  const maxRest = new Array<number>(items.length + 1).fill(0);
  for (let k = items.length - 1; k >= 0; k--) {
    const o = options.get(items[k]!.id)!;
    minRest[k] = minRest[k + 1]! + o[0]!.price;
    maxRest[k] = maxRest[k + 1]! + o[o.length - 1]!.price;
  }

  const spend = new Map<string, number>(result.vendors.map((v) => [v, 0]));
  const choice: Option[] = [];
  // Start from a greedy feasible award so the search prunes from its first node,
  // and so a large solicitation still gets a good answer if the search is cut short.
  const incumbent = greedyCapped(items.map((i) => options.get(i.id)!), cap);
  let best = incumbent ? incumbent.reduce((s, o) => s + o.price, 0) : Number.POSITIVE_INFINITY;
  let bestChoice: Option[] | null = incumbent;
  let nodes = 0;
  let truncated = false;
  const EPS = 1e-9;

  const visit = (k: number, total: number) => {
    if (++nodes > nodeLimit) {
      truncated = true;
      return;
    }
    if (total + minRest[k]! >= best - EPS) return;
    // A vendor already above cap × (largest possible final total) can never come back under it.
    for (const s of spend.values()) if (s > cap * (total + maxRest[k]!) + EPS) return;
    if (k === items.length) {
      for (const s of spend.values()) if (s > cap * total + EPS) return;
      best = total;
      bestChoice = [...choice];
      return;
    }
    for (const o of options.get(items[k]!.id)!) {
      spend.set(o.vendor, spend.get(o.vendor)! + o.price);
      choice.push(o);
      visit(k + 1, total + o.price);
      choice.pop();
      spend.set(o.vendor, spend.get(o.vendor)! - o.price);
      if (truncated) return;
    }
  };
  visit(0, 0);

  const pct = Math.round(cap * 100);
  const title = `Lowest cost, no supplier above ${pct}%`;
  if (!bestChoice) {
    const s = summarize('capped', title, '', [], uncovered, !truncated);
    s.infeasible = truncated
      ? 'The search stopped before finding an award that meets the cap.'
      : `No award keeps every supplier at or below ${pct}% with the bids received.`;
    return s;
  }
  const chosen: Option[] = bestChoice;
  const awards = items.map((item, k) => ({ itemId: item.id, vendor: chosen[k]!.vendor, extendedPrice: chosen[k]!.price }));
  // Any award costs at least the uncapped line-by-line minimum, so that is a valid lower bound.
  const lowerBound = minRest[0]!;
  const found = chosen.reduce((s, o) => s + o.price, 0);
  const gap = lowerBound > 0 ? found / lowerBound - 1 : 0;
  const scenario = summarize(
    'capped',
    title,
    truncated
      ? `Spreads supply risk across vendors. The exact search stopped at its limit, so this is the best award found; it is at most ${(gap * 100).toFixed(2)}% above the uncapped minimum.`
      : 'Spreads supply risk across vendors at the lowest cost the cap allows. Proven optimal.',
    awards,
    uncovered,
    !truncated,
  );
  scenario.lowerBound = Math.round(lowerBound * 100) / 100;
  return scenario;
}

/**
 * Greedy feasible award under a share cap: start every line at its cheapest
 * bid, then, while some vendor is over the cap, move the line that costs the
 * least extra per dollar shifted to a vendor that stays under it.
 * Returns null if it gets stuck. Used to seed the exact search.
 */
export function greedyCapped(options: Option[][], cap: number): Option[] | null {
  const pick = options.map((o) => o[0]!);
  const EPS = 1e-9;
  for (let iter = 0; iter < options.length * 8; iter++) {
    const total = pick.reduce((s, o) => s + o.price, 0);
    const spend = new Map<string, number>();
    for (const o of pick) spend.set(o.vendor, (spend.get(o.vendor) ?? 0) + o.price);
    const over = [...spend.entries()].filter(([, s]) => s > cap * total + EPS).sort((a, b) => b[1] - a[1])[0];
    if (!over) return pick;
    let bestMove: { k: number; to: Option; rate: number } | null = null;
    pick.forEach((o, k) => {
      if (o.vendor !== over[0]) return;
      for (const alt of options[k]!) {
        if (alt.vendor === o.vendor) continue;
        const newTotal = total - o.price + alt.price;
        if ((spend.get(alt.vendor) ?? 0) + alt.price > cap * newTotal + EPS) continue;
        const rate = (alt.price - o.price) / o.price;
        if (!bestMove || rate < bestMove.rate) bestMove = { k, to: alt, rate };
      }
    });
    if (!bestMove) return null;
    const m: { k: number; to: Option } = bestMove;
    pick[m.k] = m.to;
  }
  return null;
}

export function awardScenarios(result: LevelingResult, opts: AwardOptions): AwardScenario[] {
  const scenarios = [lowestCostAward(result, opts)];
  if (opts.maxVendorShare !== null) scenarios.push(concentrationCappedAward(result, { ...opts, maxVendorShare: opts.maxVendorShare }));
  scenarios.push(...singleSourceAwards(result, opts));
  return scenarios;
}
