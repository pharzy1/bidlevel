import { ATTRIBUTE_LABELS, cellStatus, type CellStatus, type Resolution } from './level.ts';
import type { BidLine, LevelingResult } from './types.ts';

/**
 * Procurement memory: what past evaluations decided, so the next re-bid starts
 * smarter. A reviewer who resolved "PMT150 PAD MOUNT XFMR..." last quarter
 * shouldn't have to resolve it again this quarter, and a 9% price jump from
 * the same vendor on the same line should be visible without digging up last
 * quarter's spreadsheet.
 */

export interface RememberedDecision {
  vendor: string;
  /** Normalized vendor description, so trivial spacing or case changes still match. */
  fingerprint: string;
  description: string;
  itemId: string;
  decidedBy: 'reviewer' | 'llm';
  round: string;
  decidedOn: string;
}

export interface RememberedPrice {
  vendor: string;
  itemId: string;
  round: string;
  unitPrice: number;
  leadTimeWeeks: number | null;
  status: CellStatus;
  /** Requirements the bid deviated from, by label. */
  deviations: string[];
}

export interface RememberedRound {
  round: string;
  closedOn: string;
  lines: number;
  vendors: string[];
}

export interface ProcurementMemory {
  version: 1;
  rounds: RememberedRound[];
  decisions: RememberedDecision[];
  prices: RememberedPrice[];
}

export const EMPTY_MEMORY: ProcurementMemory = { version: 1, rounds: [], decisions: [], prices: [] };

export function fingerprint(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9/.%]+/g, ' ')
    .trim();
}

/** Turn past decisions into resolutions for this round's lines. Only exact (normalized) description matches from the same vendor are reused. */
export function recall(memory: ProcurementMemory, bids: BidLine[], catalogIds: ReadonlySet<string>): Resolution[] {
  const latest = new Map<string, RememberedDecision>();
  for (const d of memory.decisions) latest.set(`${d.vendor}\u0000${d.fingerprint}`, d);
  const out: Resolution[] = [];
  for (const bid of bids) {
    if (bid.noBid) continue;
    const d = latest.get(`${bid.vendor}\u0000${fingerprint(bid.description)}`);
    if (!d || !catalogIds.has(d.itemId)) continue;
    out.push({
      vendor: bid.vendor,
      row: bid.row,
      itemId: d.itemId,
      source: 'memory',
      note: `Matched from memory: in ${d.round}, a ${d.decidedBy === 'llm' ? 'reviewer accepted Claude’s suggestion for' : 'reviewer matched'} this exact line to ${d.itemId} (${d.decidedOn}).`,
    });
  }
  return out;
}

/** Record a finished evaluation: the human decisions made in it and every readable price, keyed by round. */
export function closeRound(
  memory: ProcurementMemory,
  round: string,
  result: LevelingResult,
  resolutions: Resolution[],
  bids: BidLine[],
  closedOn: string,
): ProcurementMemory {
  const byRow = new Map(bids.map((b) => [`${b.vendor}\u0000${b.row}`, b]));
  const decisions = [...memory.decisions];
  for (const r of resolutions) {
    if (r.source !== 'reviewer' && r.source !== 'llm') continue;
    if (!r.itemId) continue;
    const bid = byRow.get(`${r.vendor}\u0000${r.row}`);
    if (!bid) continue;
    const fp = fingerprint(bid.description);
    const existing = decisions.findIndex((d) => d.vendor === r.vendor && d.fingerprint === fp);
    const entry: RememberedDecision = {
      vendor: r.vendor,
      fingerprint: fp,
      description: bid.description,
      itemId: r.itemId,
      decidedBy: r.source,
      round,
      decidedOn: closedOn,
    };
    if (existing >= 0) decisions[existing] = entry;
    else decisions.push(entry);
  }
  const prices = memory.prices.filter((p) => p.round !== round);
  for (const item of result.catalog) {
    for (const vendor of result.vendors) {
      const cell = result.cells[item.id]?.[vendor];
      if (!cell?.price) continue;
      prices.push({
        vendor,
        itemId: item.id,
        round,
        unitPrice: cell.price.unitPrice,
        leadTimeWeeks: cell.leadTimeWeeks,
        status: cellStatus(cell),
        deviations: cell.checks.filter((c) => c.status === 'deviates').map((c) => ATTRIBUTE_LABELS[c.name].replace(/ \(.*\)$/, '')),
      });
    }
  }
  const rounds = [
    ...memory.rounds.filter((r) => r.round !== round),
    { round, closedOn, lines: bids.length, vendors: result.vendors },
  ];
  return { version: 1, rounds, decisions, prices };
}

export interface PriceMove {
  previousRound: string;
  previousUnitPrice: number;
  /** Fractional change, e.g. 0.062 for +6.2%. */
  change: number;
  previousLeadTimeWeeks: number | null;
  /** Requirements the same vendor's bid on this line deviated from last time. */
  previousDeviations: string[];
}

/** This vendor's price for this line in the most recent earlier round, if any. */
export function priceMove(memory: ProcurementMemory, vendor: string, itemId: string, round: string, unitPrice: number): PriceMove | null {
  const order = memory.rounds.map((r) => r.round);
  const earlier = memory.prices
    .filter((p) => p.vendor === vendor && p.itemId === itemId && p.round !== round)
    .sort((a, b) => order.indexOf(b.round) - order.indexOf(a.round));
  const prev = earlier[0];
  if (!prev || prev.unitPrice <= 0) return null;
  return {
    previousRound: prev.round,
    previousUnitPrice: prev.unitPrice,
    change: unitPrice / prev.unitPrice - 1,
    previousLeadTimeWeeks: prev.leadTimeWeeks,
    previousDeviations: prev.deviations ?? [],
  };
}

/** Validate an imported memory file. Returns null when it isn't one. */
export function parseMemory(raw: unknown): ProcurementMemory | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<ProcurementMemory>;
  if (m.version !== 1 || !Array.isArray(m.rounds) || !Array.isArray(m.decisions) || !Array.isArray(m.prices)) return null;
  const ok =
    m.decisions.every((d) => typeof d?.vendor === 'string' && typeof d.fingerprint === 'string' && typeof d.itemId === 'string') &&
    m.prices.every((p) => typeof p?.vendor === 'string' && typeof p.itemId === 'string' && typeof p.unitPrice === 'number') &&
    m.rounds.every((r) => typeof r?.round === 'string');
  return ok ? (m as ProcurementMemory) : null;
}
