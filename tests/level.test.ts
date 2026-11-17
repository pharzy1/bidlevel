import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBidSheet, parseCatalog } from '../src/core/csv.ts';
import { evaluate } from '../src/core/evaluate.ts';
import { cellStatus, compareAttribute, level } from '../src/core/level.ts';
import { loadSample } from './sample.ts';

const { catalog, bids, truth } = loadSample();

describe('level on the sample re-bid', () => {
  const result = level(catalog, bids);

  it('never matches a line to the wrong catalog item, and finds every planted deviation', () => {
    const report = evaluate(result, truth);
    assert.deepEqual(report.mistakes, []);
    assert.equal(report.wrong, 0);
    assert.equal(report.falseDeviations, 0);
    assert.equal(report.deviationsFound, report.deviationsExpected);
    assert.equal(report.noBidsRecognized, 1);
    // Two lines are left for review: an alternate offer and a line with no kVA.
    assert.equal(report.abstained, 2);
    assert.equal(report.correct, report.lines - report.abstained - 1);
  });

  it('flags swapped line numbers but matches by description', () => {
    const cell = result.cells['TX-OH1-25']!['Vendor A']!;
    assert.equal(cell.bid.buyerLineRef, 7);
    assert.ok(cell.flags.some((f) => f.code === 'line_reference_conflict'));
  });

  it('sets an alternate offer aside and says which row it competes with', () => {
    const alt = result.unresolved.find((u) => u.bid.vendor === 'Vendor B' && u.bid.row === 2)!;
    assert.match(alt.reason, /alternate offer.*row 19/);
    assert.equal(result.cells['TX-PM3-150']!['Vendor B']!.bid.row, 19);
  });

  it('leaves a line that fits two items equally for review', () => {
    const u = result.unresolved.find((x) => x.bid.vendor === 'Vendor C' && x.bid.row === 2)!;
    assert.deepEqual(u.candidates.slice(0, 2).map((c) => c.itemId).sort(), ['TX-PM3-150', 'TX-PM3-75']);
  });

  it('shows a deviation when the deviating line is the only one of its kind', () => {
    const cell = result.cells['ARR-84']!['Vendor C']!;
    assert.equal(cellStatus(cell), 'deviation');
    assert.ok(!cell.compliant);
  });

  it('normalizes reel pricing and checks quantity in feet', () => {
    const cell = result.cells['CBL-15-1/0']!['Vendor C']!;
    assert.equal(cell.price!.unitPrice, 2.95);
    assert.equal(cell.extendedPrice, 44250);
    assert.ok(!cell.flags.some((f) => f.code === 'quantity_mismatch'), '6 reels of 2,500 ft is the requested 15,000 ft');
  });

  it('flags an unreadable lead time without dropping the bid', () => {
    const cell = result.cells['RCL-15-630']!['Vendor C']!;
    assert.equal(cell.leadTimeWeeks, null);
    assert.ok(cell.flags.some((f) => f.code === 'lead_time_unreadable'));
  });
});

describe('level with reviewer decisions', () => {
  it('applies a reviewer match to an unresolved line', () => {
    const result = level(catalog, bids, [{ vendor: 'Vendor C', row: 2, itemId: 'TX-PM3-150', source: 'reviewer' }]);
    const cell = result.cells['TX-PM3-150']!['Vendor C']!;
    assert.equal(cell.source, 'reviewer');
    assert.equal(cell.price!.unitPrice, 23780);
    // kVA and primary voltage were never stated, so it needs clarification before award.
    assert.equal(cellStatus(cell), 'clarify');
    assert.ok(!result.unresolved.some((u) => u.bid.vendor === 'Vendor C' && u.bid.row === 2));
  });

  it('lets a reviewer swap an alternate in for the original', () => {
    const result = level(catalog, bids, [{ vendor: 'Vendor B', row: 2, itemId: 'TX-PM3-150', source: 'reviewer' }]);
    assert.equal(result.cells['TX-PM3-150']!['Vendor B']!.bid.row, 2);
    assert.equal(cellStatus(result.cells['TX-PM3-150']!['Vendor B']), 'deviation');
    assert.ok(result.unresolved.some((u) => u.bid.vendor === 'Vendor B' && u.bid.row === 19));
  });

  it('lets a reviewer set a line aside', () => {
    const result = level(catalog, bids, [{ vendor: 'Vendor A', row: 1, itemId: null, source: 'reviewer' }]);
    assert.equal(result.cells['TX-PM3-75']!['Vendor A'], undefined);
  });
});

describe('compareAttribute', () => {
  it('accepts higher ratings where higher is better', () => {
    assert.ok(compareAttribute('amps', 100, 200));
    assert.ok(!compareAttribute('amps', 630, 600));
    assert.ok(compareAttribute('voltageClassKv', 15, 15.5));
    assert.ok(!compareAttribute('insulationLevel', 133, 100));
  });

  it('requires exact kVA and MCOV', () => {
    assert.ok(!compareAttribute('kva', 75, 150));
    assert.ok(!compareAttribute('mcovKv', 8.4, 7.65));
  });

  it('accepts a grounded-wye nameplate for a single-phase line-to-neutral primary', () => {
    assert.ok(compareAttribute('primaryVoltage', '7200', '12470GrdY/7200'));
    assert.ok(!compareAttribute('primaryVoltage', '7200', '13200GrdY/7620'));
  });
});

describe('level with small inputs', () => {
  it('reports lines it cannot identify', () => {
    const cat = parseCatalog('Description,Qty,UOM\n"Fuse cutout, 15 kV, 100 A",10,EA\n');
    const result = level(cat, parseBidSheet('V', 'Description,Price\nFreight allowance,$500\n'));
    assert.equal(result.unresolved.length, 1);
    assert.match(result.unresolved[0]!.reason, /Couldn't tell/);
  });
});
