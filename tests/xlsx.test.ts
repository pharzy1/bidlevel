import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseBidRows } from '../src/core/csv.ts';
import { decodeXml, readXlsxRows, XlsxError } from '../src/core/xlsx.ts';

const file = fileURLToPath(new URL('../public/samples/q1-2027/vendor-d.xlsx', import.meta.url));

describe('readXlsxRows', () => {
  it('reads a real workbook written by openpyxl, keeping row positions', async () => {
    const rows = await readXlsxRows(readFileSync(file));
    assert.match(rows[0]![0]!, /Vendor D: Quotation/);
    assert.deepEqual(rows[2], []);
    assert.deepEqual(rows[3], ['Line #', 'Material Description', 'Quantity', 'UOM', 'Unit Cost', 'Lead Time']);
    assert.deepEqual(rows[4], ['10', 'Cable, primary, 15kV, #1/0 AL, 133% EPR, URD', '15', 'M', '2710', '4-6 weeks']);
  });

  it('rejects files that are not workbooks', async () => {
    await assert.rejects(readXlsxRows(new TextEncoder().encode('Description,Price\n')), XlsxError);
  });

  it('decodes XML entities', () => {
    assert.equal(decodeXml('A &amp; B &lt;15kV&gt; &#8211; &#x2014;'), 'A & B <15kV> – —');
  });
});

describe('parseBidRows on a workbook', () => {
  it('finds the header below a letterhead and skips the total row', async () => {
    const lines = parseBidRows('Vendor D', await readXlsxRows(readFileSync(file)));
    assert.equal(lines.length, 4);
    assert.equal(lines[0]!.buyerLineRef, 10);
    assert.equal(lines[0]!.quantity, 15);
    assert.equal(lines[0]!.unitPriceText, '2710');
    assert.ok(lines.every((l) => !/total/i.test(l.description)));
  });
});
