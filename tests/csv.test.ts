import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CsvFormatError, parseBidSheet, parseCatalog, parseCsv, toCsv } from '../src/core/csv.ts';

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes, CRLF and a BOM', () => {
    const rows = parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n3,4');
    assert.deepEqual(rows, [
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['3', '4'],
    ]);
  });

  it('round-trips through toCsv', () => {
    const rows = [['Line', 'Description'], ['1', 'Transformer, pad-mount, "loop"']];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
  });
});

describe('parseBidSheet', () => {
  it('finds columns by alias and applies a weeks header to bare numbers', () => {
    const [line] = parseBidSheet('V', 'Part No.,Description,Qty,U/M,Price/Unit,Lead (wks)\nX1,ELBOW 200A 15KV 1/0,120,EA,$81.00,8\n');
    assert.equal(line!.description, 'ELBOW 200A 15KV 1/0');
    assert.equal(line!.unitPriceText, '$81.00');
    assert.equal(line!.leadTimeText, '8 wks');
    assert.equal(line!.quantity, 120);
    assert.equal(line!.buyerLineRef, null);
  });

  it('reads the buyer line a vendor referenced', () => {
    const [line] = parseBidSheet('V', 'Item,Description,Unit Price\n7,XFMR,$1\n');
    assert.equal(line!.buyerLineRef, 7);
  });

  it('marks no-bids', () => {
    const [line] = parseBidSheet('V', 'Description,Price\nAMI meter,NO BID\n');
    assert.equal(line!.noBid, true);
  });

  it('explains a missing column', () => {
    assert.throws(() => parseBidSheet('V', 'Foo,Bar\n1,2\n'), (e: unknown) => e instanceof CsvFormatError && /description/.test(e.message));
  });
});

describe('parseCatalog', () => {
  it('reads requirements from descriptions', () => {
    const [item] = parseCatalog('Line,Stock Code,Description,Qty,UOM\n10,CBL,"Primary cable, URD, 15 kV, 1/0 AWG AL, 133% EPR",15000,FT\n');
    assert.equal(item!.id, 'CBL');
    assert.equal(item!.uom, 'FT');
    assert.deepEqual(item!.required, { kind: 'primary_cable', voltageClassKv: 15, conductorSize: '1/0', conductorMaterial: 'AL', insulationLevel: 133 });
  });

  it('rejects a line for equipment it does not know', () => {
    assert.throws(() => parseCatalog('Description,Qty,UOM\nFreight,1,EA\n'), CsvFormatError);
  });
});
