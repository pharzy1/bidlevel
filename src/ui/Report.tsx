import { useEffect, useRef } from 'react';
import type { Recommendation } from '../core/report.ts';
import { dollars, percent, unitPrice, weeks } from './format.ts';

const BY_LABEL = { reviewer: 'Reviewer', llm: 'Reviewer, accepting Claude’s suggestion', memory: 'Procurement memory' } as const;

/** A printable award recommendation: the decision, the reasons, the excluded bids in the vendors' own words, and the audit trail. */
export function Report({ rec, rfpLabel, onClose }: { rec: Recommendation; rfpLabel: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = rec.scenario;
  const excludedCount = rec.lines.reduce((n, l) => n + l.excluded.length, 0);
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="report-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <article className="report">
        <div className="report-toolbar no-print">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <button type="button" className="btn" onClick={onClose} ref={closeRef}>
            Close
          </button>
        </div>

        <header className="report-head">
          <p className="eyebrow">Award recommendation · {today}</p>
          <h1 id="report-title">{rfpLabel}</h1>
          <p className="report-sub">Scenario: {s.title}</p>
        </header>

        <section>
          <h2>Summary</h2>
          <dl className="facts report-facts">
            <dt>Recommended award</dt>
            <dd>
              <strong>{dollars(s.total)}</strong> across {rec.lines.length} line{rec.lines.length === 1 ? '' : 's'}
            </dd>
            <dt>Suppliers</dt>
            <dd>{s.shares.map((x) => `${x.vendor} ${percent(x.share)} (${dollars(x.amount)})`).join(' · ')}</dd>
            {s.lowerBound !== undefined && (
              <>
                <dt>Versus uncapped minimum</dt>
                <dd>
                  +{dollars(s.total - s.lowerBound)} ({((s.total / s.lowerBound - 1) * 100).toFixed(2)}%) to keep every supplier within the cap
                  {s.optimal ? ', proven optimal' : ', best found'}
                </dd>
              </>
            )}
            {rec.bestSingleSource && (
              <>
                <dt>Versus single source</dt>
                <dd>
                  {rec.bestSingleSource.total >= s.total
                    ? `${dollars(rec.bestSingleSource.total - s.total)} less than awarding everything to ${rec.bestSingleSource.vendor}`
                    : `${dollars(s.total - rec.bestSingleSource.total)} more than awarding everything to ${rec.bestSingleSource.vendor}`}
                </dd>
              </>
            )}
            <dt>Before award</dt>
            <dd>
              {rec.clarificationsOpen === 0
                ? 'No open clarifications on awarded lines.'
                : `${rec.clarificationsOpen} awarded line${rec.clarificationsOpen === 1 ? ' needs' : 's need'} the vendor to confirm an unstated requirement.`}
            </dd>
            {rec.uncovered.length > 0 && (
              <>
                <dt>Not awarded</dt>
                <dd className="bad-text">
                  {rec.uncovered.map((u) => `Line ${u.line} (${u.itemId}): ${u.why}`).join(' ')}
                </dd>
              </>
            )}
          </dl>
        </section>

        <section>
          <h2>Line awards</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Awarded to</th>
                <th scope="col" className="num">
                  Unit
                </th>
                <th scope="col" className="num">
                  Extended
                </th>
                <th scope="col" className="num">
                  Lead
                </th>
                <th scope="col">Next eligible bid</th>
              </tr>
            </thead>
            <tbody>
              {rec.lines.map((l) => (
                <tr key={l.itemId}>
                  <th scope="row">
                    {l.line}. {l.itemId}
                    {l.needsClarification && <span className="badge badge-clarify report-badge">Confirm first</span>}
                  </th>
                  <td>{l.vendor}</td>
                  <td className="num">{unitPrice(l.unitPrice, l.uom)}</td>
                  <td className="num">{dollars(l.extendedPrice)}</td>
                  <td className="num">{weeks(l.leadTimeWeeks)}</td>
                  <td>
                    {l.runnerUp ? `${l.runnerUp.vendor}, ${l.runnerUp.extendedPrice >= l.extendedPrice ? '+' : '−'}${dollars(Math.abs(l.runnerUp.extendedPrice - l.extendedPrice))}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Bids not eligible for award ({excludedCount})</h2>
          {excludedCount === 0 ? (
            <p className="muted">Every bid received was eligible.</p>
          ) : (
            <ul className="report-excluded">
              {rec.lines.flatMap((l) =>
                l.excluded.map((e) => (
                  <li key={`${l.itemId}-${e.vendor}`}>
                    <strong>
                      Line {l.line} · {e.vendor} row {e.row}
                    </strong>
                    {e.extendedPrice !== null && <span className="muted"> · {dollars(e.extendedPrice)}</span>}
                    <br />
                    {e.reasons.map((r) => (/[.!?]$/.test(r) ? r : `${r}.`)).join(' ')}
                    {e.evidence.length > 0 && <span className="quote"> The bid reads “{e.evidence.join('”, “')}”.</span>}
                  </li>
                )),
              )}
            </ul>
          )}
        </section>

        <section>
          <h2>Matches made outside the automatic matcher</h2>
          {rec.decisions.length === 0 ? (
            <p className="muted">None. Every bid line was matched from its own description.</p>
          ) : (
            <ul className="report-log">
              {rec.decisions.map((d, i) => (
                <li key={i}>
                  <strong>
                    {d.vendor} row {d.row}
                  </strong>{' '}
                  · {d.by === 'memory' ? d.note : `${BY_LABEL[d.by]}: ${d.note}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Rules applied</h2>
          <ul>
            {rec.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        <footer className="report-foot">
          Prepared with BidLevel. Every requirement check cites the vendor’s submitted text. The evaluation committee makes the award decision.
        </footer>
      </article>
    </div>
  );
}
