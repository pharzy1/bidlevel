import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNoBid, normalizePrice, parseLeadTimeWeeks, parseMoney, reelLength } from '../src/core/normalize.ts';

describe('parseMoney', () => {
  it('reads dollar formats', () => {
    assert.equal(parseMoney('$18,450.00'), 18450);
    assert.equal(parseMoney('17,980'), 17980);
    assert.equal(parseMoney('USD 1,234.5'), 1234.5);
    assert.equal(parseMoney('NO BID'), null);
  });
});

describe('normalizePrice', () => {
  it('converts per-1,000-ft prices to per-foot', () => {
    const p = normalizePrice('2,890.00', 'M ft', '', 'FT')!;
    assert.equal(p.unitPrice, 2.89);
    assert.match(p.explanation, /÷ 1,000/);
  });

  it('converts reel prices using the reel length in the description', () => {
    const p = normalizePrice('$7,375.00', 'REEL', 'URD CABLE 15KV 1/0 AL 2,500 FT REEL', 'FT')!;
    assert.equal(p.unitPrice, 2.95);
  });

  it('converts per-100-ft prices', () => {
    assert.equal(normalizePrice('118', 'C', '', 'FT')!.unitPrice, 1.18);
  });

  it('refuses units it cannot convert rather than guessing', () => {
    assert.equal(normalizePrice('$7,375.00', 'REEL', 'URD CABLE no length given', 'FT'), null);
    assert.equal(normalizePrice('$100', 'LOT', '', 'EA'), null);
    assert.equal(normalizePrice('$100', 'FT', '', 'EA'), null);
  });

  it('passes each-priced items through', () => {
    assert.equal(normalizePrice('$118.40', 'EA', '', 'EA')!.unitPrice, 118.4);
    assert.equal(normalizePrice('59.90', 'each', '', 'EA')!.unitPrice, 59.9);
  });
});

describe('reelLength', () => {
  it('reads reel lengths', () => {
    assert.equal(reelLength('2,500 FT REEL'), 2500);
    assert.equal(reelLength("cable on reels of 1000'"), 1000);
    assert.equal(reelLength('no reel here'), null);
  });
});

describe('parseLeadTimeWeeks', () => {
  it('takes the upper end of ranges and converts units', () => {
    assert.equal(parseLeadTimeWeeks('38 WKS'), 38);
    assert.equal(parseLeadTimeWeeks('12-14 weeks ARO'), 14);
    assert.equal(parseLeadTimeWeeks('9-10 months'), 44);
    assert.equal(parseLeadTimeWeeks('90 days'), 13);
    assert.equal(parseLeadTimeWeeks('Stock'), 0);
  });

  it('returns null for text without a duration', () => {
    assert.equal(parseLeadTimeWeeks('TBD'), null);
    assert.equal(parseLeadTimeWeeks('Q3 2027'), null);
  });
});

describe('isNoBid', () => {
  it('recognizes no-bid markers', () => {
    assert.ok(isNoBid('NO BID'));
    assert.ok(isNoBid('N/B'));
    assert.ok(isNoBid(''));
    assert.ok(!isNoBid('$12.00'));
  });
});
