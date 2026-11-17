import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { awardScenarios, concentrationCappedAward, greedyCapped, type AwardOptions } from '../src/core/award.ts';
import { clarificationLetter, clarificationRequests } from '../src/core/clarify.ts';
import { parseBidRows, parseBidSheet } from '../src/core/csv.ts';
import { cellStatus, level, type Resolution } from '../src/core/level.ts';
import { closeRound, EMPTY_MEMORY, fingerprint, parseMemory, priceMove, recall } from '../src/core/memory.ts';
import { buildRecommendation } from '../src/core/report.ts';
import { generateSolicitation } from '../src/core/synthetic.ts';
import { readXlsxRows } from '../src/core/xlsx.ts';
import { loadSample } from './sample.ts';

const opts: AwardOptions = { includeClarifications: true, maxLeadTimeWeeks: null, maxVendorShare: 0.5 };
const q4 = loadSample();
const dir = fileURLToPath(new URL('../public/samples/q1-2027/', import.meta.url));

async function loadQ1() {
  const csv = (v: string, f: string) => parseBidSheet(v, readFileSync(dir + f, 'utf8'));
  return [
    ...csv('Vendor A', 'vendor-a.csv'),
    ...csv('Vendor B', 'vendor-b.csv'),
    ...csv('Vendor C', 'vendor-c.csv'),
    ...parseBidRows('Vendor D', await readXlsxRows(readFileSync(dir + 'vendor-d.xlsx'))),
  ];
}

describe('procurement memory across two quarters', () => {
  const q4Decisions: Resolution[] = [{ vendor: 'Vendor C', row: 2, itemId: 'TX-PM3-150', source: 'reviewer' }];
  const q4Result = level(q4.catalog, q4.bids, q4Decisions);
  const memory = closeRound(EMPTY_MEMORY, 'Q4 2026', q4Result, q4Decisions, q4.bids, '2026-11-16');

  it('records the reviewer’s decision and every readable price', () => {
    assert.equal(memory.decisions.length, 1);
    assert.equal(memory.decisions[0]!.fingerprint, fingerprint('PMT150 PAD MOUNT XFMR 3PH LOOP FR3 208Y/120'));
    assert.ok(memory.prices.length > 45);
    assert.deepEqual(memory.rounds.map((r) => r.round), ['Q4 2026']);
  });

  it('resolves the same line automatically next quarter and shows price moves', async () => {
    const bids = await loadQ1();
    const recalled = recall(memory, bids, new Set(q4.catalog.map((i) => i.id)));
    assert.equal(recalled.length, 1);
    const result = level(q4.catalog, bids, recalled);
    const cell = result.cells['TX-PM3-150']!['Vendor C']!;
    assert.equal(cell.source, 'memory');
    assert.match(cell.note!, /Q4 2026/);
    assert.equal(result.unresolved.length, 0);

    const move = priceMove(memory, 'Vendor A', 'TX-PM3-75', 'Q1 2027', result.cells['TX-PM3-75']!['Vendor A']!.price!.unitPrice)!;
    assert.equal(move.previousRound, 'Q4 2026');
    assert.ok(Math.abs(move.change - (19650 / 18450 - 1)) < 1e-9);
  });

  it('remembers a repeated deviation', async () => {
    const result = level(q4.catalog, await loadQ1(), []);
    const cell = result.cells['CND-336']!['Vendor B']!;
    assert.equal(cellStatus(cell), 'deviation');
    const move = priceMove(memory, 'Vendor B', 'CND-336', 'Q1 2027', cell.price!.unitPrice)!;
    assert.deepEqual(move.previousDeviations, ['Stranding']);
  });

  it('levels the Excel price sheet alongside the CSVs', async () => {
    const result = level(q4.catalog, await loadQ1(), []);
    assert.equal(result.cells['CBL-15-1/0']!['Vendor D']!.price!.unitPrice, 2.71);
    assert.ok(!result.cells['CBL-15-1/0']!['Vendor D']!.flags.some((f) => f.code === 'quantity_mismatch'));
  });

  it('round-trips through JSON and rejects malformed files', () => {
    assert.deepEqual(parseMemory(JSON.parse(JSON.stringify(memory))), memory);
    assert.equal(parseMemory({ version: 2 }), null);
    assert.equal(parseMemory('nope'), null);
  });
});

describe('clarification requests', () => {
  const result = level(q4.catalog, q4.bids);
  const requests = clarificationRequests(result);

  it('asks each vendor about its own deviations, gaps and ambiguous rows', () => {
    const c = requests.find((r) => r.vendor === 'Vendor C')!;
    const text = c.items.flatMap((i) => i.asks).join('\n');
    assert.match(text, /MCOV 7\.65.*“7\.65KV MCOV”.*8\.4/);
    assert.match(text, /firm lead time.*“TBD”/);
    assert.match(text, /line 1 or line 2|line 2 or line 1/);
    const b = requests.find((r) => r.vendor === 'Vendor B')!.items.flatMap((i) => i.asks).join('\n');
    assert.match(b, /alternate offer/);
    assert.match(b, /efficiency standard/);
  });

  it('asks Vendor A only about its mislabelled line numbers', () => {
    const a = requests.find((r) => r.vendor === 'Vendor A')!;
    assert.equal(a.items.length, 2);
    assert.ok(a.items.every((i) => i.asks.every((x) => /labelled line/.test(x))));
  });

  it('asks a partial bidder which lines it is declining', async () => {
    const r = clarificationRequests(level(q4.catalog, await loadQ1()));
    const d = r.find((x) => x.vendor === 'Vendor D')!;
    assert.match(d.items.at(-1)!.asks[0]!, /no price for RFP lines 1–9, 14–18/);
  });

  it('writes a letter that quotes the vendor', () => {
    const letter = clarificationLetter(requests.find((r) => r.vendor === 'Vendor C')!, 'Q4 2026 distribution materials re-bid', 'December 1');
    assert.match(letter, /^Subject: Clarification request/);
    assert.match(letter, /“ARRESTER 9KV DUTY 7\.65KV MCOV POLYMER”/);
    assert.match(letter, /by December 1/);
  });
});

describe('award recommendation', () => {
  const result = level(q4.catalog, q4.bids);
  const scenarios = awardScenarios(result, opts);
  const capped = scenarios.find((s) => s.key === 'capped')!;
  const rec = buildRecommendation(result, capped, scenarios, opts, []);

  it('covers every awarded line and explains each excluded bid with the vendor’s words', () => {
    assert.equal(rec.lines.length, capped.awards.length);
    const line4 = rec.lines.find((l) => l.itemId === 'TX-PM3-1500')!;
    const b = line4.excluded.find((e) => e.vendor === 'Vendor B')!;
    assert.match(b.reasons[0]!, /Mineral oil/);
    assert.deepEqual(b.evidence, ['mineral oil']);
  });

  it('names the runner-up and the best single-source alternative', () => {
    assert.ok(rec.lines.every((l) => l.runnerUp === null || l.runnerUp.vendor !== l.vendor));
    assert.equal(rec.bestSingleSource?.vendor, 'Vendor A');
    assert.ok(rec.rules.some((r) => /50%/.test(r)));
  });
});

describe('award at scale', () => {
  it('greedy repair finds a feasible capped award', () => {
    const options = [
      [{ vendor: 'A', price: 100 }, { vendor: 'B', price: 110 }],
      [{ vendor: 'A', price: 100 }, { vendor: 'B', price: 105 }],
    ];
    // At 50% this is infeasible ($105 of $205 is 51%), so cap at 60%.
    assert.equal(greedyCapped(options, 0.5), null);
    const pick = greedyCapped(options, 0.6)!;
    assert.deepEqual(pick.map((o) => o.vendor).sort(), ['A', 'B']);
    assert.equal(pick.find((o) => o.vendor === 'B')!.price, 105);
  });

  it('levels a 248-SKU, 6-vendor solicitation with no wrong matches and no deviation passed as compliant', () => {
    const { catalog, bids, truth } = generateSolicitation(6, 11);
    const result = level(catalog, bids);
    let wrong = 0;
    let matched = 0;
    for (const [itemId, row] of Object.entries(result.cells)) {
      for (const cell of Object.values(row)) {
        if (!cell) continue;
        matched++;
        const key = `${cell.vendor}#${cell.bid.row}`;
        if (truth.lines.get(key) !== itemId) wrong++;
        if (truth.deviated.has(key)) assert.equal(cellStatus(cell), 'deviation', key);
      }
    }
    assert.equal(wrong, 0);
    assert.ok(matched / bids.length > 0.97, `matched ${matched} of ${bids.length}`);
    const capped = concentrationCappedAward(result, { ...opts, maxVendorShare: 0.3 });
    assert.ok(!capped.infeasible);
    assert.ok(capped.shares.every((s) => s.share <= 0.3 + 1e-9));
    assert.ok(capped.total >= capped.lowerBound!);
  });
});
