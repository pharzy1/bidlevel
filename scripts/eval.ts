/**
 * Score the deterministic matcher against the hand-labeled sample.
 * Run with `npm run eval`. No model calls, so it is free and repeatable.
 */
import { evaluate } from '../src/core/evaluate.ts';
import { level } from '../src/core/level.ts';
import { loadSample } from '../tests/sample.ts';

const { catalog, bids, truth } = loadSample();
const result = level(catalog, bids);
const r = evaluate(result, truth);
const matchable = r.lines - r.noBidsRecognized;
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;

console.log(`Lines labeled:           ${r.lines}`);
console.log(`Matched correctly:       ${r.correct} (${pct(r.correct, matchable)} of bid lines)`);
console.log(`Matched wrongly:         ${r.wrong}`);
console.log(`Left for review:         ${r.abstained}`);
console.log(`No-bids recognized:      ${r.noBidsRecognized}`);
console.log(`Deviations found:        ${r.deviationsFound} of ${r.deviationsExpected}`);
console.log(`False deviations:        ${r.falseDeviations}`);
if (r.mistakes.length > 0) {
  console.log('\nMistakes:');
  for (const m of r.mistakes) console.log(`  - ${m}`);
  process.exitCode = 1;
}
