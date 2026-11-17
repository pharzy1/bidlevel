/**
 * Level a solicitation the size of HillStar's published case study (~250
 * grid-equipment SKUs per vendor) and report speed and accuracy.
 * Run with `npm run benchmark -- [vendors]` (default 22).
 */
import { awardScenarios } from '../src/core/award.ts';
import { cellStatus, level } from '../src/core/level.ts';
import { generateSolicitation } from '../src/core/synthetic.ts';

const vendors = Number(process.argv[2] ?? 22);
const { catalog, bids, truth } = generateSolicitation(vendors);

const t0 = performance.now();
const result = level(catalog, bids);
const t1 = performance.now();
const scenarios = awardScenarios(result, { includeClarifications: true, maxLeadTimeWeeks: null, maxVendorShare: 0.3 });
const t2 = performance.now();

let correct = 0;
let wrong = 0;
let deviationsFlagged = 0;
let deviationsPassedAsCompliant = 0;
const matched = new Map<string, { itemId: string; status: string }>();
for (const [itemId, row] of Object.entries(result.cells)) {
  for (const cell of Object.values(row)) if (cell) matched.set(`${cell.vendor}#${cell.bid.row}`, { itemId, status: cellStatus(cell) });
}
for (const [key, expected] of truth.lines) {
  const got = matched.get(key);
  if (!got) continue;
  if (got.itemId === expected) correct++;
  else wrong++;
}
for (const key of truth.deviated) {
  const got = matched.get(key);
  if (got?.status === 'deviation') deviationsFlagged++;
  else if (got) deviationsPassedAsCompliant++;
}
const review = result.unresolved.length;
const capped = scenarios.find((s) => s.key === 'capped')!;
const lowest = scenarios.find((s) => s.key === 'lowest')!;

console.log(`Solicitation:        ${catalog.length} SKUs × ${vendors} vendors = ${bids.length.toLocaleString('en-US')} priced lines`);
console.log(`Leveling time:       ${(t1 - t0).toFixed(0)} ms`);
console.log(`Award scenarios:     ${(t2 - t1).toFixed(0)} ms`);
console.log(`Matched correctly:   ${correct.toLocaleString('en-US')} (${((100 * correct) / bids.length).toFixed(1)}%)`);
console.log(`Matched wrongly:     ${wrong}`);
console.log(`Left for review:     ${review} (${((100 * review) / bids.length).toFixed(1)}%)`);
console.log(`Planted deviations:  ${truth.deviated.size} → ${deviationsFlagged} flagged, ${truth.deviated.size - deviationsFlagged - deviationsPassedAsCompliant} sent to review, ${deviationsPassedAsCompliant} passed as compliant`);
console.log(
  `30% supplier cap:    ${capped.infeasible ?? `$${capped.total.toLocaleString('en-US')} vs $${lowest.total.toLocaleString('en-US')} uncapped (+${((capped.total / lowest.total - 1) * 100).toFixed(2)}%), ${capped.optimal ? 'proven optimal' : 'best found'}`}`,
);
if (wrong > 0 || deviationsPassedAsCompliant > 0) process.exitCode = 1;
