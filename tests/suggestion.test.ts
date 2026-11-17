import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { level } from '../src/core/level.ts';
import { buildResolveRequest, ResolveRequestSchema, userPrompt, validateSuggestion } from '../src/llm/suggestion.ts';
import { loadSample } from './sample.ts';

const { catalog, bids } = loadSample();
const result = level(catalog, bids);
const line = result.unresolved.find((u) => u.bid.vendor === 'Vendor C' && u.bid.row === 2)!;
const request = buildResolveRequest(line, catalog);

describe('buildResolveRequest', () => {
  it('sends only same-kind candidates and passes its own schema', () => {
    assert.ok(ResolveRequestSchema.safeParse(request).success);
    assert.ok(request.candidates.every((c) => c.required.kind === 'padmount_transformer'));
    assert.ok(request.candidates.some((c) => c.id === 'TX-PM3-150'));
  });

  it('puts the supplier text and candidates in the prompt', () => {
    const prompt = userPrompt(request);
    assert.match(prompt, /PMT150 PAD MOUNT XFMR/);
    assert.match(prompt, /candidate id="TX-PM3-150"/);
  });
});

describe('validateSuggestion', () => {
  it('accepts a grounded answer and locates each quote', () => {
    const s = validateSuggestion(
      { itemId: 'TX-PM3-150', evidence: [{ claim: 'The part code encodes 150 kVA', quote: 'PMT150' }], rationale: 'The code names the rating.' },
      request,
    );
    assert.equal(s.status, 'suggested');
    if (s.status === 'suggested') {
      assert.equal(s.evidence[0]!.start, 0);
      assert.equal(s.evidence[0]!.end, 6);
    }
  });

  it('rejects a quote that is not in the vendor text', () => {
    const s = validateSuggestion({ itemId: 'TX-PM3-150', evidence: [{ claim: 'rated 150 kVA', quote: '150 kVA' }], rationale: '' }, request);
    assert.equal(s.status, 'rejected');
  });

  it('rejects a quote that differs only in case', () => {
    const s = validateSuggestion({ itemId: 'TX-PM3-150', evidence: [{ claim: 'code', quote: 'pmt150' }], rationale: '' }, request);
    assert.equal(s.status, 'rejected');
  });

  it('rejects an item that was not offered as a candidate', () => {
    const s = validateSuggestion({ itemId: 'MTR-2S', evidence: [{ claim: 'x', quote: 'PMT150' }], rationale: '' }, request);
    assert.equal(s.status, 'rejected');
  });

  it('rejects an answer without evidence', () => {
    assert.equal(validateSuggestion({ itemId: 'TX-PM3-150', evidence: [], rationale: 'trust me' }, request).status, 'rejected');
  });

  it('rejects a malformed answer', () => {
    assert.equal(validateSuggestion({ choice: 'TX-PM3-150' }, request).status, 'rejected');
    assert.equal(validateSuggestion(null, request).status, 'rejected');
  });

  it('passes a decline through', () => {
    const s = validateSuggestion({ itemId: null, evidence: [], rationale: 'Not enough to tell.' }, request);
    assert.deepEqual(s, { status: 'declined', rationale: 'Not enough to tell.' });
  });
});
