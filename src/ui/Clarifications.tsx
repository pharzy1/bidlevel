import { useMemo, useState } from 'react';
import { clarificationLetter, clarificationRequests } from '../core/clarify.ts';
import type { LevelingResult } from '../core/types.ts';

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** One ready-to-send clarification request per vendor, built from the leveler's findings. */
export function Clarifications({ result, rfpLabel }: { result: LevelingResult; rfpLabel: string }) {
  const requests = useMemo(() => clarificationRequests(result), [result]);
  const [respondBy, setRespondBy] = useState(defaultDate);
  const [copied, setCopied] = useState<string | null>(null);

  if (requests.length === 0) return <p className="muted">No clarifications needed. Every bid states every requirement and a readable price and lead time.</p>;

  async function copy(vendor: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(vendor);
      setTimeout(() => setCopied((c) => (c === vendor ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="clarify">
      <label className="field field-inline">
        <span>Responses due</span>
        <input type="date" value={respondBy} onChange={(e) => setRespondBy(e.target.value)} />
      </label>
      {requests.map((r) => {
        const letter = clarificationLetter(r, rfpLabel, longDate(respondBy));
        const count = r.items.reduce((n, i) => n + i.asks.length, 0);
        return (
          <details key={r.vendor} className="letter">
            <summary>
              <strong>{r.vendor}</strong>
              <span className="muted">
                {count} question{count === 1 ? '' : 's'}
              </span>
            </summary>
            <pre className="letter-text">{letter}</pre>
            <div className="row">
              <button type="button" className="btn btn-small" onClick={() => copy(r.vendor, letter)}>
                {copied === r.vendor ? 'Copied' : 'Copy letter'}
              </button>
            </div>
          </details>
        );
      })}
    </div>
  );
}
