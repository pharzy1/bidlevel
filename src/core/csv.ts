import { extractAttributes } from './extract.ts';
import { isNoBid } from './normalize.ts';
import type { AttributeName, AttributeValue, BidLine, CatalogItem, Uom } from './types.ts';

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export class CsvFormatError extends Error {}

function columnIndex(header: string[], aliases: RegExp, label: string, required: boolean): number {
  const idx = header.findIndex((h) => aliases.test(h.trim()));
  if (idx === -1 && required) {
    throw new CsvFormatError(`No ${label} column. Columns found: ${header.map((h) => `"${h}"`).join(', ')}`);
  }
  return idx;
}

const ALIASES = {
  description: /^(item\s+)?desc(ription)?\.?$|^material(\s+description)?$|^product$/i,
  quantity: /^(qty|quantity|quan\.?)$/i,
  uom: /^(uom|u\/m|unit|units|unit of measure)$/i,
  price: /^(unit\s+)?(price|cost)(\s+each)?(\s*\(usd\))?$|^price\s*\/\s*unit$|^\$\s*\/\s*unit$/i,
  lead: /^(lead(\s*time)?|delivery|ARO|lead\s*\(.*\))$/i,
  buyerLine: /^(item|line|bid\s*item|ref|line\s*#|item\s*#|rfp\s*line)$/i,
  stockCode: /^(stock\s*code|sku|catalog\s*#|id)$/i,
};

function parseQuantity(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse the buyer's solicitation. Requirements are read from each description with the same extractor used for bids. */
export function parseCatalog(text: string): CatalogItem[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new CsvFormatError('The catalog file is empty.');
  const iDesc = columnIndex(header, ALIASES.description, 'description', true);
  const iQty = columnIndex(header, ALIASES.quantity, 'quantity', true);
  const iUom = columnIndex(header, ALIASES.uom, 'unit of measure', true);
  const iLine = columnIndex(header, ALIASES.buyerLine, 'line number', false);
  const iCode = columnIndex(header, ALIASES.stockCode, 'stock code', false);
  return rows.map((r, n) => {
    const description = r[iDesc]?.trim() ?? '';
    const uomRaw = (r[iUom] ?? '').trim().toUpperCase();
    const uom: Uom = /^(FT|LF|FEET)$/.test(uomRaw) ? 'FT' : 'EA';
    const quantity = parseQuantity(r[iQty]);
    if (!description || quantity === null) {
      throw new CsvFormatError(`Catalog row ${n + 1} needs a description and a positive quantity.`);
    }
    const required: Partial<Record<AttributeName, AttributeValue>> = {};
    for (const a of extractAttributes(description)) required[a.name] = a.value;
    if (!required.kind) {
      throw new CsvFormatError(`Catalog row ${n + 1} ("${description}") doesn't name an equipment type the leveler knows.`);
    }
    const line = iLine >= 0 ? Number(r[iLine]) : n + 1;
    return {
      id: (iCode >= 0 && r[iCode]?.trim()) || `L${line}`,
      line: Number.isFinite(line) ? line : n + 1,
      description,
      quantity,
      uom,
      required,
    };
  });
}

/** Parse one vendor's price sheet from CSV text. */
export function parseBidSheet(vendor: string, text: string): BidLine[] {
  return parseBidRows(vendor, parseCsv(text));
}

const TOTAL_ROW = /^\s*(sub\s*)?total\b|^\s*grand\s+total\b/i;

/**
 * Parse one vendor's price sheet from rows (CSV or a worksheet). Header names
 * vary by vendor, so columns are found by alias, and the header row is the
 * first one with both a description and a price column, so a letterhead above
 * the table is skipped. Blank and total rows are ignored.
 */
export function parseBidRows(vendor: string, allRows: string[][]): BidLine[] {
  const nonEmpty = allRows.filter((r) => r.some((f) => f.trim() !== ''));
  if (nonEmpty.length === 0) throw new CsvFormatError(`${vendor}'s file is empty.`);
  const headerAt = nonEmpty.slice(0, 25).findIndex((r) => r.some((h) => ALIASES.description.test(h.trim())) && r.some((h) => ALIASES.price.test(h.trim())));
  const header = nonEmpty[Math.max(headerAt, 0)]!;
  const rows = nonEmpty.slice(Math.max(headerAt, 0) + 1);
  const iDesc = columnIndex(header, ALIASES.description, 'description', true);
  const iPrice = columnIndex(header, ALIASES.price, 'unit price', true);
  const iQty = columnIndex(header, ALIASES.quantity, 'quantity', false);
  const iUom = columnIndex(header, ALIASES.uom, 'unit of measure', false);
  const iLead = columnIndex(header, ALIASES.lead, 'lead time', false);
  const iLine = columnIndex(header, ALIASES.buyerLine, 'buyer line', false);
  // A header such as "Lead (wks)" gives the unit for bare numbers in that column.
  const leadUnit = iLead >= 0 ? (/w(?:ee)?ks?\b/i.test(header[iLead]!) ? 'wks' : /days?\b/i.test(header[iLead]!) ? 'days' : /months?|mos?\b/i.test(header[iLead]!) ? 'months' : '') : '';
  const priced = rows.filter((r) => !r.some((f) => TOTAL_ROW.test(f)));
  return priced.map((r, n) => {
    const description = (r[iDesc] ?? '').trim();
    const leadRaw = iLead >= 0 ? (r[iLead] ?? '').trim() : '';
    const unitPriceText = (r[iPrice] ?? '').trim();
    const ref = iLine >= 0 ? Number((r[iLine] ?? '').trim()) : NaN;
    return {
      vendor,
      row: n + 1,
      buyerLineRef: Number.isInteger(ref) && ref > 0 ? ref : null,
      description,
      quantity: iQty >= 0 ? parseQuantity(r[iQty]) : null,
      uomText: iUom >= 0 ? (r[iUom] ?? '').trim() : '',
      unitPriceText,
      leadTimeText: leadUnit && /^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?$/.test(leadRaw) ? `${leadRaw} ${leadUnit}` : leadRaw,
      noBid: isNoBid(unitPriceText, description),
    };
  });
}

function csvField(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}
