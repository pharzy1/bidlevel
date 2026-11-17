import type { LevelingResult } from './types.ts';

export interface Truth {
  lines: Record<string, Record<string, string | null>>;
  deviations: { vendor: string; itemId: string; attribute: string }[];
}

export interface EvalReport {
  lines: number;
  /** Matched automatically to the labeled catalog line. */
  correct: number;
  /** Matched automatically to the wrong catalog line. The number that must stay at zero. */
  wrong: number;
  /** Left for review instead of guessed. */
  abstained: number;
  /** No-bid rows recognized as no-bids. */
  noBidsRecognized: number;
  deviationsFound: number;
  deviationsExpected: number;
  /** Deviations reported that the labels don't contain. */
  falseDeviations: number;
  mistakes: string[];
}

/** Score a leveling result against hand labels. */
export function evaluate(result: LevelingResult, truth: Truth): EvalReport {
  const matched = new Map<string, string>();
  for (const [itemId, row] of Object.entries(result.cells)) {
    for (const cell of Object.values(row)) if (cell) matched.set(`${cell.vendor}#${cell.bid.row}`, itemId);
  }
  const noBid = new Set(result.noBids.map((b) => `${b.vendor}#${b.row}`));
  const report: EvalReport = {
    lines: 0,
    correct: 0,
    wrong: 0,
    abstained: 0,
    noBidsRecognized: 0,
    deviationsFound: 0,
    deviationsExpected: truth.deviations.length,
    falseDeviations: 0,
    mistakes: [],
  };
  for (const [vendor, rows] of Object.entries(truth.lines)) {
    for (const [row, expected] of Object.entries(rows)) {
      report.lines++;
      const key = `${vendor}#${row}`;
      const got = matched.get(key);
      if (expected === null) {
        if (noBid.has(key)) report.noBidsRecognized++;
        else report.mistakes.push(`${vendor} row ${row}: expected a no-bid, got ${got ?? 'unresolved'}`);
      } else if (got === undefined) report.abstained++;
      else if (got === expected) report.correct++;
      else {
        report.wrong++;
        report.mistakes.push(`${vendor} row ${row}: expected ${expected}, matched ${got}`);
      }
    }
  }
  const expected = new Set(truth.deviations.map((d) => `${d.vendor}#${d.itemId}#${d.attribute}`));
  for (const [itemId, row] of Object.entries(result.cells)) {
    for (const cell of Object.values(row)) {
      for (const c of cell?.checks ?? []) {
        if (c.status !== 'deviates') continue;
        if (expected.has(`${cell!.vendor}#${itemId}#${c.name}`)) report.deviationsFound++;
        else {
          report.falseDeviations++;
          report.mistakes.push(`${cell!.vendor} ${itemId}: unexpected deviation on ${c.name}`);
        }
      }
    }
  }
  return report;
}
