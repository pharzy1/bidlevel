import type { AwardOptions, AwardScenario } from './award.ts';
import { cellStatus, type Resolution } from './level.ts';
import type { LevelingResult } from './types.ts';

/**
 * Everything an evaluation committee needs to sign off on an award: what goes
 * to whom and why, what each excluded bid failed on in the vendor's own
 * words, which matches a person (or memory) made, and the rules applied.
 */

export interface ExcludedBid {
  vendor: string;
  row: number;
  extendedPrice: number | null;
  reasons: string[];
  /** The vendor text the reasons are about. */
  evidence: string[];
}

export interface AwardLine {
  line: number;
  itemId: string;
  description: string;
  quantity: number;
  uom: 'EA' | 'FT';
  vendor: string;
  unitPrice: number;
  extendedPrice: number;
  leadTimeWeeks: number | null;
  needsClarification: boolean;
  /** Next-cheapest eligible bid, to show what the choice saved or cost. */
  runnerUp: { vendor: string; extendedPrice: number } | null;
  excluded: ExcludedBid[];
}

export interface DecisionLogEntry {
  vendor: string;
  row: number;
  itemId: string | null;
  by: 'reviewer' | 'llm' | 'memory';
  note: string;
}

export interface Recommendation {
  scenario: AwardScenario;
  lines: AwardLine[];
  uncovered: { line: number; itemId: string; why: string }[];
  decisions: DecisionLogEntry[];
  rules: string[];
  clarificationsOpen: number;
  /** Cheapest complete single-source award, for comparison. Null if no vendor can cover every line. */
  bestSingleSource: { vendor: string; total: number } | null;
}

export function buildRecommendation(
  result: LevelingResult,
  scenario: AwardScenario,
  allScenarios: AwardScenario[],
  options: AwardOptions,
  resolutions: Resolution[],
): Recommendation {
  const awardOf = new Map(scenario.awards.map((a) => [a.itemId, a]));
  const lines: AwardLine[] = [];
  const uncovered: Recommendation['uncovered'] = [];
  let clarificationsOpen = 0;

  for (const item of result.catalog) {
    const award = awardOf.get(item.id);
    const row = result.cells[item.id] ?? {};
    const excluded: ExcludedBid[] = [];
    const eligible: { vendor: string; price: number }[] = [];
    for (const vendor of result.vendors) {
      const cell = row[vendor];
      if (!cell) continue;
      const status = cellStatus(cell);
      const reasons: string[] = [];
      const evidence: string[] = [];
      if (status === 'deviation') {
        reasons.push(...cell.flags.filter((f) => f.code === 'deviation').map((f) => f.message));
        for (const c of cell.checks) if (c.status === 'deviates' && c.evidence) evidence.push(c.evidence.quote);
      } else if (status === 'clarify' && !options.includeClarifications) {
        reasons.push(...cell.flags.filter((f) => f.code === 'not_stated' || f.code === 'price_unreadable').map((f) => f.message));
      } else if (cell.extendedPrice === null) {
        reasons.push('Price could not be read.');
      } else if (options.maxLeadTimeWeeks !== null && (cell.leadTimeWeeks === null || cell.leadTimeWeeks > options.maxLeadTimeWeeks)) {
        reasons.push(cell.leadTimeWeeks === null ? 'No firm lead time.' : `Lead time ${cell.leadTimeWeeks} weeks exceeds the ${options.maxLeadTimeWeeks}-week limit.`);
      } else {
        eligible.push({ vendor, price: cell.extendedPrice });
      }
      if (reasons.length > 0) excluded.push({ vendor, row: cell.bid.row, extendedPrice: cell.extendedPrice, reasons, evidence });
    }

    if (!award) {
      uncovered.push({
        line: item.line,
        itemId: item.id,
        why: excluded.length > 0 ? 'Every bid received is excluded by the award rules.' : 'No vendor bid this line.',
      });
      continue;
    }
    const cell = row[award.vendor]!;
    const needsClarification = cellStatus(cell) === 'clarify';
    if (needsClarification) clarificationsOpen++;
    const others = eligible.filter((e) => e.vendor !== award.vendor).sort((a, b) => a.price - b.price);
    lines.push({
      line: item.line,
      itemId: item.id,
      description: item.description,
      quantity: item.quantity,
      uom: item.uom,
      vendor: award.vendor,
      unitPrice: cell.price!.unitPrice,
      extendedPrice: award.extendedPrice,
      leadTimeWeeks: cell.leadTimeWeeks,
      needsClarification,
      runnerUp: others[0] ? { vendor: others[0].vendor, extendedPrice: others[0].price } : null,
      excluded,
    });
  }

  const decisions: DecisionLogEntry[] = [];
  for (const item of result.catalog) {
    for (const vendor of result.vendors) {
      const cell = result.cells[item.id]?.[vendor];
      if (!cell || cell.source === 'deterministic') continue;
      decisions.push({
        vendor,
        row: cell.bid.row,
        itemId: item.id,
        by: cell.source,
        note:
          cell.note ??
          (cell.source === 'llm' ? `Reviewer accepted Claude’s suggestion to match this row to ${item.id}.` : `Reviewer matched this row to ${item.id}.`),
      });
    }
  }
  for (const r of resolutions) {
    if (r.itemId === null) decisions.push({ vendor: r.vendor, row: r.row, itemId: null, by: 'reviewer', note: 'Reviewer set this row aside as a wrong match.' });
  }

  const rules = [
    'Bids that deviate from a stated requirement are not eligible for award.',
    options.includeClarifications
      ? 'Bids that leave a requirement unstated are eligible, subject to the vendor confirming it before award.'
      : 'Bids that leave a requirement unstated are not eligible.',
    options.maxLeadTimeWeeks !== null ? `Bids must deliver within ${options.maxLeadTimeWeeks} weeks.` : 'No delivery limit was applied.',
    options.maxVendorShare !== null && scenario.key === 'capped'
      ? `No supplier may receive more than ${Math.round(options.maxVendorShare * 100)}% of the award.`
      : 'No supplier concentration limit was applied to this scenario.',
    'Prices are normalized to the RFP unit of measure and extended at the requested quantity.',
  ];

  const singles = allScenarios.filter((s) => s.key.startsWith('single:') && s.uncovered.length === 0 && !s.infeasible).sort((a, b) => a.total - b.total);
  const bestSingleSource = singles[0] ? { vendor: singles[0].key.slice('single:'.length), total: singles[0].total } : null;

  return { scenario, lines, uncovered, decisions, rules, clarificationsOpen, bestSingleSource };
}
