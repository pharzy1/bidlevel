import { minCostAssignment } from './assign.ts';
import { extractAttributes } from './extract.ts';
import { catalogUnitsPer, normalizePrice, parseLeadTimeWeeks } from './normalize.ts';
import type {
  AttributeCheck,
  AttributeName,
  AttributeValue,
  BidLine,
  CatalogItem,
  ExtractedAttribute,
  Flag,
  LeveledCell,
  LevelingResult,
  MatchSource,
  UnresolvedLine,
} from './types.ts';

/** Ratings where a higher offered value still meets the requirement. */
const AT_LEAST: ReadonlySet<AttributeName> = new Set(['voltageClassKv', 'amps', 'insulationLevel']);

export const ATTRIBUTE_LABELS: Record<AttributeName, string> = {
  kind: 'Equipment type',
  phases: 'Phases',
  kva: 'kVA',
  primaryVoltage: 'Primary voltage',
  secondaryVoltage: 'Secondary voltage',
  fluid: 'Insulating fluid',
  efficiencyStandard: 'Efficiency standard',
  voltageClassKv: 'Voltage class (kV)',
  amps: 'Current rating (A)',
  mcovKv: 'MCOV (kV)',
  conductorSize: 'Conductor size',
  conductorMaterial: 'Conductor material',
  insulationLevel: 'Insulation level (%)',
  stranding: 'Stranding',
  meterForm: 'Meter form',
  meterClass: 'Meter class',
  ways: 'Ways',
  feed: 'Feed',
};

const VALUE_LABELS: Record<string, string> = {
  natural_ester: 'Natural ester (FR3)',
  mineral_oil: 'Mineral oil',
  'DOE-2016': 'DOE 2016 (10 CFR 431)',
  loop: 'Loop feed',
  radial: 'Radial feed',
};

const UNITS: Partial<Record<AttributeName, (v: AttributeValue) => string>> = {
  kva: (v) => `${v} kVA`,
  voltageClassKv: (v) => `${v} kV`,
  mcovKv: (v) => `${v} kV`,
  amps: (v) => `${v} A`,
  insulationLevel: (v) => `${v}%`,
  ways: (v) => `${v}-way`,
  phases: (v) => (v === 1 ? 'Single phase' : `${v} phase`),
  meterForm: (v) => `Form ${v}`,
  meterClass: (v) => `Class ${v}`,
};

/** A value as a reviewer would write it, with its unit when the attribute is known. */
export function displayValue(v: AttributeValue | null, name?: AttributeName): string {
  if (v === null) return 'Not stated';
  if (name && UNITS[name]) return UNITS[name]!(v);
  return VALUE_LABELS[String(v)] ?? String(v);
}

/** An attribute's name for use mid-sentence: "the MCOV", "the insulating fluid". */
export function attributePhrase(name: AttributeName): string {
  const label = ATTRIBUTE_LABELS[name].replace(/ \(.*\)$/, '');
  return /^[A-Z]{2,}/.test(label) || label === 'kVA' ? label : label.toLowerCase();
}

export function compareAttribute(name: AttributeName, required: AttributeValue, offered: AttributeValue): boolean {
  if (AT_LEAST.has(name) && typeof required === 'number' && typeof offered === 'number') return offered >= required;
  if (name === 'primaryVoltage' && /^\d+$/.test(String(required))) {
    // A single-phase unit specified "7200" is met by a "12470GrdY/7200" nameplate.
    return String(offered) === String(required) || String(offered).endsWith(`/${required}`);
  }
  return String(required) === String(offered);
}

const MEETS = 3;
const MEETS_BY_EXCEEDING = 1.5;
const NOT_STATED = -0.5;
const DEVIATES = -4;
const LINE_REF_AGREES = 2;
/** A line whose best two candidates score closer than this goes to review. */
export const AMBIGUITY_MARGIN = 1;

export function checkAttributes(item: CatalogItem, offered: ExtractedAttribute[]): AttributeCheck[] {
  const byName = new Map(offered.map((a) => [a.name, a]));
  return (Object.entries(item.required) as [AttributeName, AttributeValue][])
    .filter(([name]) => name !== 'kind')
    .map(([name, required]) => {
      const o = byName.get(name);
      if (!o) return { name, required, offered: null, status: 'not_stated' as const, evidence: null };
      return {
        name,
        required,
        offered: o.value,
        status: compareAttribute(name, required, o.value) ? ('meets' as const) : ('deviates' as const),
        evidence: o.evidence,
      };
    });
}

/** Score how well a bid line fits a catalog item. Returns null when the equipment type differs. */
export function scoreLine(item: CatalogItem, bid: BidLine, offered: ExtractedAttribute[]): number | null {
  const kind = offered.find((a) => a.name === 'kind')?.value;
  if (kind !== item.required.kind) return null;
  let score = 0;
  for (const c of checkAttributes(item, offered)) {
    if (c.status === 'meets') {
      // A 25 kV cable meets a 15 kV requirement, but it is far more likely to be the
      // offer for the 25 kV line. Exact ratings outrank exceeding ones.
      score += String(c.offered) === String(c.required) ? MEETS : MEETS_BY_EXCEEDING;
    } else score += c.status === 'deviates' ? DEVIATES : NOT_STATED;
  }
  if (bid.buyerLineRef === item.line) score += LINE_REF_AGREES;
  return score;
}

/** A decision made outside the deterministic matcher: by the model or by a reviewer. */
export interface Resolution {
  vendor: string;
  row: number;
  /** Catalog item the line is for, or null to set the line aside. */
  itemId: string | null;
  source: Exclude<MatchSource, 'deterministic'>;
  note?: string;
}

function lineKey(vendor: string, row: number): string {
  return `${vendor}\u0000${row}`;
}

function buildCell(
  item: CatalogItem,
  bid: BidLine,
  offered: ExtractedAttribute[],
  source: MatchSource,
  score: number,
  note?: string,
): LeveledCell {
  const checks = checkAttributes(item, offered);
  const flags: Flag[] = [];
  for (const c of checks) {
    if (c.status === 'deviates') {
      flags.push({
        code: 'deviation',
        message: `${ATTRIBUTE_LABELS[c.name].replace(/ \(.*\)$/, '')}: required ${displayValue(c.required, c.name)}, offered ${displayValue(c.offered, c.name)}`,
      });
    }
  }
  const missing = checks.filter((c) => c.status === 'not_stated');
  if (missing.length > 0) {
    flags.push({
      code: 'not_stated',
      message: `Not stated in the bid: ${missing.map((c) => `${ATTRIBUTE_LABELS[c.name].replace(/ \(.*\)$/, '')} (${displayValue(c.required, c.name)})`).join(', ')}`,
    });
  }
  if (bid.buyerLineRef !== null && bid.buyerLineRef !== item.line) {
    flags.push({
      code: 'line_reference_conflict',
      message: `The vendor labelled this row as line ${bid.buyerLineRef}, but its description matches line ${item.line}.`,
    });
  }
  if (bid.quantity !== null) {
    // "6 REEL" of 2,500 ft is 15,000 ft; quantities quoted per 1,000 ft are already in feet.
    const per = catalogUnitsPer(bid.uomText, bid.description, item.uom);
    const quoted = per !== null && per > 1 && bid.quantity * per <= item.quantity * 10 ? bid.quantity * per : bid.quantity;
    if (quoted !== item.quantity) {
      flags.push({
        code: 'quantity_mismatch',
        message: `Quoted quantity ${quoted.toLocaleString('en-US')} differs from the requested ${item.quantity.toLocaleString('en-US')}. Extended price uses the requested quantity.`,
      });
    }
  }
  const price = normalizePrice(bid.unitPriceText, bid.uomText, bid.description, item.uom);
  if (!price) {
    flags.push({
      code: 'price_unreadable',
      message: `Couldn't read a price from "${bid.unitPriceText}" per "${bid.uomText || 'no unit given'}".`,
    });
  }
  const leadTimeWeeks = bid.leadTimeText ? parseLeadTimeWeeks(bid.leadTimeText) : null;
  if (leadTimeWeeks === null) {
    flags.push({
      code: 'lead_time_unreadable',
      message: bid.leadTimeText ? `Couldn't read a lead time from "${bid.leadTimeText}".` : 'No lead time given.',
    });
  }
  return {
    itemId: item.id,
    vendor: bid.vendor,
    bid,
    source,
    score,
    checks,
    price,
    extendedPrice: price ? Math.round(price.unitPrice * item.quantity * 100) / 100 : null,
    leadTimeWeeks,
    flags,
    compliant: price !== null && checks.every((c) => c.status === 'meets'),
    ...(note ? { note } : {}),
  };
}

/**
 * Match every vendor line to the buyer's catalog, normalize prices and lead
 * times, and collect what needs a human (or the model) to look at.
 *
 * Within each vendor, lines are assigned to catalog items one-to-one with the
 * Hungarian algorithm over attribute-match scores, so a vendor's two
 * transformer lines can't both land on the same catalog line. Lines whose top
 * two candidates are nearly tied are not guessed at: they go to `unresolved`.
 */
export function level(catalog: CatalogItem[], bids: BidLine[], resolutions: Resolution[] = []): LevelingResult {
  const vendors = [...new Set(bids.map((b) => b.vendor))];
  const cells: LevelingResult['cells'] = Object.fromEntries(catalog.map((i) => [i.id, {}]));
  const unresolved: UnresolvedLine[] = [];
  const noBids: BidLine[] = [];
  const itemsById = new Map(catalog.map((i) => [i.id, i]));
  const decided = new Map(resolutions.map((r) => [lineKey(r.vendor, r.row), r]));

  for (const vendor of vendors) {
    const lines = bids.filter((b) => b.vendor === vendor);
    const taken = new Set<string>();
    const pending: { bid: BidLine; attrs: ExtractedAttribute[]; scores: Map<string, number> }[] = [];

    for (const bid of lines) {
      const attrs = extractAttributes(bid.description);
      const resolution = decided.get(lineKey(vendor, bid.row));
      if (resolution) {
        const item = resolution.itemId ? itemsById.get(resolution.itemId) : undefined;
        if (item && !taken.has(item.id)) {
          taken.add(item.id);
          cells[item.id]![vendor] = buildCell(item, bid, attrs, resolution.source, scoreLine(item, bid, attrs) ?? 0, resolution.note);
        } else {
          const candidates = catalog
            .map((i) => ({ itemId: i.id, score: scoreLine(i, bid, attrs) }))
            .filter((c): c is { itemId: string; score: number } => c.score !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
          unresolved.push({
            bid,
            attributes: attrs,
            candidates,
            reason: item ? `A reviewer matched this to ${item.id}, which already has an offer from this vendor.` : 'A reviewer set this line aside.',
          });
        }
        continue;
      }
      if (bid.noBid) {
        noBids.push(bid);
        continue;
      }
      const scores = new Map<string, number>();
      for (const item of catalog) {
        const s = scoreLine(item, bid, attrs);
        if (s !== null) scores.set(item.id, s);
      }
      pending.push({ bid, attrs, scores });
    }

    const ranking = (p: (typeof pending)[number]) =>
      [...p.scores.entries()].filter(([id]) => !taken.has(id)).sort((a, b) => b[1] - a[1]);
    const top3 = (ranked: [string, number][]) => ranked.slice(0, 3).map(([itemId, score]) => ({ itemId, score }));

    const confident: typeof pending = [];
    for (const p of pending) {
      const ranked = ranking(p);
      const candidates = top3(ranked);
      if (!p.attrs.some((a) => a.name === 'kind')) {
        unresolved.push({ bid: p.bid, attributes: p.attrs, candidates, reason: "Couldn't tell what equipment this line is for." });
      } else if (ranked.length === 0) {
        unresolved.push({ bid: p.bid, attributes: p.attrs, candidates, reason: 'No open catalog line is for this type of equipment.' });
      } else if (ranked.length > 1 && ranked[0]![1] <= 0) {
        unresolved.push({ bid: p.bid, attributes: p.attrs, candidates, reason: 'No catalog line fits well enough to match automatically.' });
      } else if (ranked.length > 1 && ranked[0]![1] - ranked[1]![1] < AMBIGUITY_MARGIN) {
        unresolved.push({
          bid: p.bid,
          attributes: p.attrs,
          candidates,
          reason: `Fits ${ranked[0]![0]} and ${ranked[1]![0]} equally well. The description doesn't say enough to tell them apart.`,
        });
      } else confident.push(p);
    }

    const open = catalog.filter((i) => !taken.has(i.id));
    // How many open catalog lines share each equipment type. A line that is the only
    // candidate of its type is matched even when it deviates, so the deviation is shown.
    const openOfKind = new Map<unknown, number>();
    for (const i of open) openOfKind.set(i.required.kind, (openOfKind.get(i.required.kind) ?? 0) + 1);

    const assigned = new Map<(typeof pending)[number], CatalogItem>();
    // Lines can only match items of their own equipment type, so the assignment
    // problem splits into one small problem per type. At 250 SKUs per vendor this
    // turns one 250×500 solve into a few dozen tiny ones.
    const kindOf = (p: (typeof pending)[number]) => p.attrs.find((a) => a.name === 'kind')!.value;
    const groups = new Map<unknown, (typeof pending)[number][]>();
    for (const p of confident) groups.set(kindOf(p), [...(groups.get(kindOf(p)) ?? []), p]);
    for (const [kind, lines] of groups) {
      const items = open.filter((i) => i.required.kind === kind);
      if (items.length === 0) continue;
      // Offsetting real matches below the zero-cost "leave unmatched" padding columns
      // makes the solver place every line it can, while still preferring better fits.
      const BLOCKED = 1e6;
      const OFFSET = 1e3;
      const cost = lines.map((p) => [
        ...items.map((i) => {
          const s = p.scores.get(i.id);
          return s === undefined ? BLOCKED : -(s + OFFSET);
        }),
        ...lines.map(() => 0),
      ]);
      const assignment = minCostAssignment(cost);
      lines.forEach((p, r) => {
        const col = assignment[r]!;
        const item = col < items.length && cost[r]![col]! < 0 ? items[col] : undefined;
        if (item && (p.scores.get(item.id)! > 0 || openOfKind.get(item.required.kind) === 1)) assigned.set(p, item);
      });
    }

    for (const [p, item] of assigned) {
      cells[item.id]![vendor] = buildCell(item, p.bid, p.attrs, 'deterministic', p.scores.get(item.id)!);
    }
    for (const p of confident) {
      if (assigned.has(p)) continue;
      const ranked = [...p.scores.entries()].sort((a, b) => b[1] - a[1]);
      const best = ranked[0];
      const holder = best ? cells[best[0]]?.[vendor] : undefined;
      unresolved.push({
        bid: p.bid,
        attributes: p.attrs,
        candidates: top3(ranked),
        reason: holder
          ? `Looks like an alternate offer: ${best![0]} is already matched to this vendor's row ${holder.bid.row}, which fits it better.`
          : 'No open catalog line fits this description.',
      });
    }
  }

  return { catalog, vendors, cells, unresolved, noBids };
}

/** Status shown in a leveling-matrix cell. */
export type CellStatus = 'compliant' | 'clarify' | 'deviation' | 'no_bid';

export function cellStatus(cell: LeveledCell | undefined): CellStatus {
  if (!cell) return 'no_bid';
  if (cell.flags.some((f) => f.code === 'deviation')) return 'deviation';
  if (!cell.compliant) return 'clarify';
  return 'compliant';
}
