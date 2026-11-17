import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectKind, extractAttributes } from '../src/core/extract.ts';

function attrs(text: string) {
  return Object.fromEntries(extractAttributes(text).map((a) => [a.name, a.value]));
}

describe('extractAttributes', () => {
  it('reads one primary voltage from every common spelling', () => {
    for (const text of [
      'XFMR PADMT 3PH 75KVA 12470GY/7200-208Y/120',
      'Three-phase pad-mounted transformer, 75 kVA, 12.47 kV GrdY/7.2 kV primary, 208Y/120 V secondary',
      'PAD MOUNT XFMR 3PH 75 KVA 12470GRDY/7200 208Y/120',
      'Transformer, pad-mount, 3 phase, 75 kVA, 12470Y/7200 - 208Y/120',
    ]) {
      const a = attrs(text);
      assert.equal(a.primaryVoltage, '12470GrdY/7200', text);
      assert.equal(a.secondaryVoltage, '208Y/120', text);
      assert.equal(a.kva, 75, text);
      assert.equal(a.phases, 3, text);
    }
  });

  it('treats 277/480 and 480Y/277 as the same secondary', () => {
    assert.equal(attrs('pad mount transformer 3 phase 500 kVA 12470GrdY/7200 277/480').secondaryVoltage, '480Y/277');
  });

  it('converts MVA to kVA', () => {
    assert.equal(attrs('Three-phase pad-mounted transformer, 1.5 MVA').kva, 1500);
  });

  it('reads single-phase primaries written as one voltage', () => {
    assert.equal(attrs('XFMR OH 1PH 25KVA 7200V 120/240').primaryVoltage, '7200');
    assert.equal(attrs('Single-phase pole-mounted transformer, 25 kVA, 7.2 kV primary, 120/240 V').primaryVoltage, '7200');
    assert.equal(attrs('XFMR OH 1PH 25KVA 7200V 120/240').secondaryVoltage, '120/240');
  });

  it('expands conductor codewords to size and stranding', () => {
    assert.deepEqual(
      { size: attrs('336.4 ACSR LINNET').conductorSize, strand: attrs('336.4 ACSR LINNET').stranding },
      { size: '336.4', strand: '26/7' },
    );
    assert.equal(attrs('Bare ACSR conductor 336.4 kcmil 30/7 (Oriole)').stranding, '30/7');
    assert.equal(attrs('4/0 ACSR 6/1 PENGUIN').stranding, '6/1');
    assert.equal(attrs('4/0 ACSR 6/1 PENGUIN').conductorSize, '4/0');
  });

  it('reads a cable voltage class even when "primary" follows it', () => {
    assert.equal(attrs('15 kV primary cable, 750 kcmil aluminum, 100% insulation').voltageClassKv, 15);
    assert.equal(attrs('15 kV primary cable, 750 kcmil aluminum, 100% insulation').conductorSize, '750');
  });

  it('reads MCOV rather than the duty-cycle rating on arresters', () => {
    assert.equal(attrs('ARRESTER 9KV DUTY 7.65KV MCOV POLYMER').mcovKv, 7.65);
    assert.equal(attrs('surge arrester, 10 kV duty cycle / 8.4 kV MCOV').mcovKv, 8.4);
  });

  it('records evidence that is an exact slice of the input', () => {
    const text = 'Three-phase pad-mounted transformer, 0.5 MVA, 12.47 kV GrdY/7.2 kV - 480Y/277 V, mineral oil';
    for (const a of extractAttributes(text)) {
      assert.equal(text.slice(a.evidence.start, a.evidence.end), a.evidence.quote);
      assert.ok(a.evidence.quote.length > 0);
    }
  });

  it('returns nothing for text it cannot place', () => {
    assert.deepEqual(extractAttributes('Freight, prepaid and allowed'), []);
  });
});

describe('detectKind', () => {
  it('prefers the more specific kind when a description names two', () => {
    assert.equal(detectKind('Load-break elbow, 15 kV, 200 A, for 1/0 AWG cable')?.value, 'loadbreak_elbow');
    assert.equal(detectKind('Pad-mount switchgear, 15 kV, 600 A, 4-way')?.value, 'padmount_switchgear');
    assert.equal(detectKind('POLE TYPE XFMR 1PH 25 KVA')?.value, 'overhead_transformer');
    assert.equal(detectKind('PMT150 PAD MOUNT XFMR 3PH')?.value, 'padmount_transformer');
  });
});
