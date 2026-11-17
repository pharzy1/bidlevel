import { extractAttributes } from './extract.ts';
import { attributePhrase, displayValue, scoreLine } from './level.ts';
import type { CatalogItem, LevelingResult } from './types.ts';

/**
 * Turn what the leveler found into the clarification requests an evaluator
 * sends each vendor before award: every deviation, unstated requirement,
 * unreadable price or lead time, and ambiguous line, each tied to the vendor's
 * own row and words.
 */

export interface ClarificationItem {
  /** RFP line, or null for a vendor row that isn't matched to one. */
  line: number | null;
  itemId: string | null;
  row: number | null;
  quote: string;
  asks: string[];
}

export interface ClarificationRequest {
  vendor: string;
  items: ClarificationItem[];
}

function ranges(nums: number[]): string {
  const sorted = [...nums].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

function unitWord(item: CatalogItem): string {
  return item.uom === 'FT' ? 'foot' : 'each';
}

export function clarificationRequests(result: LevelingResult): ClarificationRequest[] {
  return result.vendors
    .map((vendor) => {
      const items: ClarificationItem[] = [];
      for (const item of result.catalog) {
        const cell = result.cells[item.id]?.[vendor];
        if (!cell) continue;
        const asks: string[] = [];
        for (const c of cell.checks) {
          const label = attributePhrase(c.name);
          const required = displayValue(c.required, c.name);
          if (c.status === 'deviates') {
            asks.push(
              `You offered ${label} ${displayValue(c.offered, c.name)}${c.evidence ? ` (“${c.evidence.quote}”)` : ''}. The RFP requires ${required}. Can you supply ${required}, and if so, at what price and lead time?`,
            );
          } else if (c.status === 'not_stated') {
            asks.push(`Your line doesn’t state the ${label}. Please confirm it is ${required}.`);
          }
        }
        for (const f of cell.flags) {
          if (f.code === 'price_unreadable') asks.push(`Please restate the unit price per ${unitWord(item)}.`);
          if (f.code === 'lead_time_unreadable') {
            asks.push(cell.bid.leadTimeText ? `Please give a firm lead time in weeks. You quoted “${cell.bid.leadTimeText}”.` : 'Please give a lead time in weeks.');
          }
          if (f.code === 'quantity_mismatch') asks.push(`Please confirm you can supply the requested ${item.quantity.toLocaleString('en-US')} ${item.uom === 'FT' ? 'ft' : 'units'}.`);
          if (f.code === 'line_reference_conflict') {
            asks.push(`This row is labelled line ${cell.bid.buyerLineRef}, but its description matches line ${item.line}. Please confirm which line it prices.`);
          }
        }
        if (asks.length > 0) items.push({ line: item.line, itemId: item.id, row: cell.bid.row, quote: cell.bid.description, asks });
      }

      for (const u of result.unresolved.filter((x) => x.bid.vendor === vendor)) {
        const alt = /alternate offer/.test(u.reason);
        const candidates = u.candidates
          .map((c) => result.catalog.find((i) => i.id === c.itemId))
          .filter((i): i is CatalogItem => Boolean(i));
        const lines = candidates.slice(0, 2).map((i) => i.line);
        items.push({
          line: null,
          itemId: null,
          row: u.bid.row,
          quote: u.bid.description,
          asks: [
            alt
              ? `This row looks like an alternate offer for line ${lines[0] ?? '?'}. Please confirm whether it is an alternate and which offer you propose as your base bid.`
              : lines.length > 1
                ? `This row doesn’t say enough to tell whether it prices line ${lines[0]} or line ${lines[1]}. Please confirm the RFP line and state the full rating.`
                : 'Please confirm which RFP line this row prices.',
          ],
        });
      }

      // Lines this vendor neither priced, declined in writing, nor sent a row we're still placing.
      const explained = new Set<string>();
      for (const i of result.catalog) if (result.cells[i.id]?.[vendor]) explained.add(i.id);
      for (const u of result.unresolved.filter((x) => x.bid.vendor === vendor)) {
        const top = u.candidates[0]?.score;
        for (const c of u.candidates) if (c.score === top) explained.add(c.itemId);
      }
      for (const b of result.noBids.filter((x) => x.vendor === vendor)) {
        const attrs = extractAttributes(b.description);
        const best = result.catalog
          .map((i) => ({ id: i.id, s: scoreLine(i, b, attrs) }))
          .filter((x): x is { id: string; s: number } => x.s !== null)
          .sort((a, b2) => b2.s - a.s)[0];
        if (best) explained.add(best.id);
      }
      const missing = result.catalog.filter((i) => !explained.has(i.id)).map((i) => i.line);
      if (missing.length > 0) {
        items.push({
          line: null,
          itemId: null,
          row: null,
          quote: '',
          asks: [`Your bid has no price for RFP line${missing.length === 1 ? '' : 's'} ${ranges(missing)}. Please confirm whether you are declining ${missing.length === 1 ? 'it' : 'them'}.`],
        });
      }
      return { vendor, items };
    })
    .filter((r) => r.items.length > 0);
}

/** A plain-text letter, ready to paste into an email. */
export function clarificationLetter(req: ClarificationRequest, rfpLabel: string, respondBy: string): string {
  const lines: string[] = [];
  lines.push(`Subject: Clarification request: ${rfpLabel}`);
  lines.push('');
  lines.push(`Hello ${req.vendor} team,`);
  lines.push('');
  const quotes = req.items.some((i) => i.quote);
  lines.push(
    `Thank you for your bid. Before we can complete our evaluation, please answer the following by ${respondBy}.${quotes ? ' Where an item is about a row of your price sheet, it quotes that row.' : ''}`,
  );
  lines.push('');
  req.items.forEach((it, n) => {
    const where = [it.line !== null ? `RFP line ${it.line} (${it.itemId})` : null, it.row !== null ? `your row ${it.row}` : null].filter(Boolean).join(', ');
    lines.push(`${n + 1}. ${where || 'General'}`);
    if (it.quote) lines.push(`   “${it.quote}”`);
    for (const a of it.asks) lines.push(`   - ${a}`);
    lines.push('');
  });
  lines.push('Answers that change a price or a specification should come as a revised line on your price sheet.');
  lines.push('');
  lines.push('Thank you,');
  return lines.join('\n');
}
