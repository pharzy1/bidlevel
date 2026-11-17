import { useState } from 'react';
import { ATTRIBUTE_LABELS } from '../core/level.ts';
import type { CatalogItem, UnresolvedLine } from '../core/types.ts';
import type { Suggestion } from '../llm/suggestion.ts';
import { Highlight } from './Highlight.tsx';

export type SuggestionState = { state: 'loading' } | { state: 'done'; suggestion: Suggestion } | { state: 'error'; message: string };

export function lineKey(vendor: string, row: number) {
  return `${vendor}#${row}`;
}

function SuggestionView({ s, catalog, onAccept }: { s: SuggestionState; catalog: CatalogItem[]; onAccept: (itemId: string) => void }) {
  if (s.state === 'loading') return <p className="suggestion muted" aria-live="polite">Asking Claude…</p>;
  if (s.state === 'error') return <p className="suggestion error" role="alert">{s.message}</p>;
  const g = s.suggestion;
  if (g.status === 'declined') {
    return (
      <div className="suggestion">
        <p>
          <strong>Claude didn’t pick one.</strong> {g.rationale}
        </p>
      </div>
    );
  }
  if (g.status === 'rejected') {
    return (
      <div className="suggestion error">
        <p>
          <strong>Answer discarded:</strong> it didn’t pass the grounding check.
        </p>
        <ul>
          {g.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </div>
    );
  }
  const item = catalog.find((i) => i.id === g.itemId);
  return (
    <div className="suggestion suggested">
      <p>
        <strong>Claude suggests {item ? `${item.line}. ${item.id}` : g.itemId}.</strong> {g.rationale}
      </p>
      <ul className="evidence-list">
        {g.evidence.map((e, i) => (
          <li key={i}>
            <mark className="ev ev-neutral">{e.quote}</mark> {e.claim}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary" onClick={() => onAccept(g.itemId)}>
        Accept suggestion
      </button>
    </div>
  );
}

/** Lines the matcher wouldn't guess at. A person decides each one, optionally with a grounded suggestion from Claude. */
export function ReviewQueue({
  lines,
  catalog,
  suggestions,
  onAsk,
  onResolve,
}: {
  lines: UnresolvedLine[];
  catalog: CatalogItem[];
  suggestions: Record<string, SuggestionState | undefined>;
  onAsk: (line: UnresolvedLine) => void;
  onResolve: (line: UnresolvedLine, itemId: string, source: 'llm' | 'reviewer') => void;
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  if (lines.length === 0) return <p className="muted">Nothing waiting. Every bid line is matched or recorded as a no-bid.</p>;

  return (
    <ol className="queue">
      {lines.map((u) => {
        const key = lineKey(u.bid.vendor, u.bid.row);
        const options = u.candidates.length > 0 ? u.candidates.map((c) => catalog.find((i) => i.id === c.itemId)!).filter(Boolean) : catalog;
        const selected = choice[key] ?? options[0]?.id ?? '';
        const s = suggestions[key];
        return (
          <li key={key} className="queue-item">
            <p className="eyebrow">
              {u.bid.vendor} · row {u.bid.row} · {u.bid.unitPriceText || 'no price'}
            </p>
            <Highlight
              text={u.bid.description}
              marks={u.attributes
                .filter((a) => a.name !== 'kind')
                .map((a) => ({ start: a.evidence.start, end: a.evidence.end, label: `${ATTRIBUTE_LABELS[a.name]}: ${a.value}`, tone: 'neutral' as const }))}
            />
            <p className="reason">{u.reason}</p>
            <div className="queue-actions">
              <label className="field">
                <span>Match to</span>
                <select value={selected} onChange={(e) => setChoice({ ...choice, [key]: e.target.value })}>
                  {options.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.line}. {i.id}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" disabled={!selected} onClick={() => onResolve(u, selected, 'reviewer')}>
                Match
              </button>
              <button type="button" className="btn" disabled={s?.state === 'loading'} onClick={() => onAsk(u)}>
                Ask Claude
              </button>
            </div>
            {s && <SuggestionView s={s} catalog={catalog} onAccept={(itemId) => onResolve(u, itemId, 'llm')} />}
          </li>
        );
      })}
    </ol>
  );
}
