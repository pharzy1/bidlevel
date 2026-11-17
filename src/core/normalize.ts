import type { NormalizedPrice, Uom } from './types.ts';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function formatUsd(n: number): string {
  return usd.format(n);
}

/** Parse "$1,234.50", "USD 1,234", "1234.5". Returns null when no amount is present. */
export function parseMoney(text: string): number | null {
  const m = /(-?\d[\d,]*(?:\.\d+)?)/.exec(text.replace(/\s+/g, ''));
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function isNoBid(priceText: string, description = ''): boolean {
  return /\bno[\s-]*bid\b|\bN\/B\b|\bdecline/i.test(`${priceText} ${description}`) || priceText.trim() === '' || priceText.trim() === '-';
}

interface PricingUnit {
  /** How many catalog units one priced unit holds. */
  catalogUnitsPer: number;
  catalogUom: Uom;
  label: string;
}

/** Read a reel length from a description such as "2,500 FT REEL" or "(2500')". */
export function reelLength(description: string): number | null {
  const m = /(\d[\d,]{2,})\s*(?:ft|feet|')\s*(?:\/\s*)?(?:reel|rl)\b|\breels?\s*(?:of|@)\s*(\d[\d,]{2,})\s*(?:ft|feet|')/i.exec(description);
  const raw = m?.[1] ?? m?.[2];
  return raw ? Number(raw.replace(/,/g, '')) : null;
}

function pricingUnit(uomText: string, description: string, catalogUom: Uom): PricingUnit | null {
  const u = uomText.trim().toUpperCase().replace(/^PER\s+|^\//, '');
  if (catalogUom === 'EA') {
    return /^(EA|EACH|E|PC|PCS|UNIT)$/.test(u) || u === '' ? { catalogUnitsPer: 1, catalogUom: 'EA', label: 'each' } : null;
  }
  if (/^(FT|LF|FOOT|FEET|')$/.test(u)) return { catalogUnitsPer: 1, catalogUom: 'FT', label: 'per ft' };
  if (/^(M|MFT|KFT|M\s*FT|1000\s*FT|THOUSAND\s*FT)$/.test(u)) return { catalogUnitsPer: 1000, catalogUom: 'FT', label: 'per 1,000 ft' };
  if (/^(C|CFT|100\s*FT|HUNDRED\s*FT)$/.test(u)) return { catalogUnitsPer: 100, catalogUom: 'FT', label: 'per 100 ft' };
  if (/^(REEL|RL)$/.test(u)) {
    const len = reelLength(description);
    return len ? { catalogUnitsPer: len, catalogUom: 'FT', label: `per ${len.toLocaleString('en-US')} ft reel` } : null;
  }
  return null;
}

/** How many catalog units one of the vendor's units holds (1,000 for "per M ft"), or null if the unit isn't understood. */
export function catalogUnitsPer(uomText: string, description: string, catalogUom: Uom): number | null {
  return pricingUnit(uomText, description, catalogUom)?.catalogUnitsPer ?? null;
}

/**
 * Convert a vendor's price into dollars per catalog unit, with a sentence that
 * shows the arithmetic so a reviewer can check it.
 */
export function normalizePrice(priceText: string, uomText: string, description: string, catalogUom: Uom): NormalizedPrice | null {
  const amount = parseMoney(priceText);
  if (amount === null || amount < 0) return null;
  const unit = pricingUnit(uomText, description, catalogUom);
  if (!unit) return null;
  const unitPrice = amount / unit.catalogUnitsPer;
  const per = catalogUom === 'EA' ? 'each' : 'per ft';
  const explanation =
    unit.catalogUnitsPer === 1
      ? `${formatUsd(amount)} ${per}, as quoted`
      : `${formatUsd(amount)} ${unit.label} ÷ ${unit.catalogUnitsPer.toLocaleString('en-US')} = ${formatUsd(unitPrice)} ${per}`;
  return { unitPrice, explanation };
}

const WEEKS_PER_MONTH = 52 / 12;

/**
 * Lead time in whole weeks, taking the upper end of a range: "38 wks" → 38,
 * "12-14 weeks ARO" → 14, "9-10 months" → 44, "90 days" → 13, "stock" → 0.
 * Returns null for anything else, such as "Q3 2027" or "TBD".
 */
export function parseLeadTimeWeeks(text: string): number | null {
  const t = text.trim();
  if (/^(stock|in\s*stock|from\s*stock|ex[\s-]*stock|immediate)$/i.test(t) || /\bstock\b/i.test(t) && !/\d/.test(t)) return 0;
  const m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(w(?:ee)?ks?|wk|months?|mos?|days?|d)\b/i.exec(t);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  const unit = m[3]!.toLowerCase();
  if (unit.startsWith('w')) return Math.ceil(n);
  if (unit.startsWith('m')) return Math.ceil(n * WEEKS_PER_MONTH);
  return Math.ceil(n / 7);
}
