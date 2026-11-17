import { ATTRIBUTE_LABELS, cellStatus, displayValue } from '../core/level.ts';
import type { CatalogItem, LeveledCell } from '../core/types.ts';
import type { PriceMove } from '../core/memory.ts';
import { dollars, unitPrice, weeks } from './format.ts';
import { Highlight, type Mark } from './Highlight.tsx';
import { MoveBadge, StatusBadge } from './Matrix.tsx';

const show = displayValue;

function quotedPrice(priceText: string, uomText: string): string {
  if (!priceText) return '—';
  if (!uomText || /^(ea|each|e|pc|pcs|unit)$/i.test(uomText.trim())) return `${priceText} each`;
  return `${priceText} per ${uomText}`;
}

/** Everything behind one matrix cell: the vendor's words, each requirement checked against them, and the price arithmetic. */
export function CellDetail({
  item,
  cell,
  move,
  onSetAside,
  onUndo,
}: {
  item: CatalogItem;
  cell: LeveledCell;
  move: PriceMove | null;
  onSetAside: () => void;
  onUndo: (() => void) | null;
}) {
  const repeat = move && cellStatus(cell) === 'deviation' && move.previousDeviations.length > 0 ? move : null;
  const marks: Mark[] = cell.checks
    .filter((c) => c.evidence)
    .map((c) => ({
      start: c.evidence!.start,
      end: c.evidence!.end,
      label: `${ATTRIBUTE_LABELS[c.name]}: ${show(c.offered, c.name)}`,
      tone: c.status === 'meets' ? 'meets' : 'deviates',
    }));

  return (
    <div className="detail">
      <header className="detail-head">
        <p className="eyebrow">
          {cell.vendor} · row {cell.bid.row}
          {cell.bid.buyerLineRef !== null && ` · labelled line ${cell.bid.buyerLineRef}`}
        </p>
        <h2>
          {item.line}. {item.id}
        </h2>
        <StatusBadge status={cellStatus(cell)} />
        {cell.note && <p className="note">{cell.note}</p>}
      </header>

      <section aria-labelledby="src-h">
        <h3 id="src-h">What the vendor wrote</h3>
        <Highlight text={cell.bid.description} marks={marks} />
        <p className="hint">Highlighted text is the evidence for each check below. Hover a highlight to see what was read from it.</p>
      </section>

      <section aria-labelledby="chk-h">
        <h3 id="chk-h">Requirements</h3>
        <table className="checks">
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Required</th>
              <th scope="col">Offered</th>
            </tr>
          </thead>
          <tbody>
            {cell.checks.map((c) => (
              <tr key={c.name} className={`check-${c.status}`}>
                <th scope="row">{ATTRIBUTE_LABELS[c.name]}</th>
                <td>{show(c.required, c.name)}</td>
                <td>
                  <span className="check-icon" aria-hidden="true">
                    {c.status === 'meets' ? '✓' : c.status === 'deviates' ? '✕' : '?'}
                  </span>
                  {show(c.offered, c.name)}
                  <span className="sr-only">{c.status === 'meets' ? ' meets' : c.status === 'deviates' ? ' deviates' : ' not stated'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="price-h">
        <h3 id="price-h">Price and delivery</h3>
        <dl className="facts">
          <dt>Quoted</dt>
          <dd>{quotedPrice(cell.bid.unitPriceText, cell.bid.uomText)}</dd>
          <dt>Normalized</dt>
          <dd>{cell.price ? cell.price.explanation : 'Unreadable'}</dd>
          <dt>Extended</dt>
          <dd>
            {cell.extendedPrice !== null
              ? `${dollars(cell.extendedPrice)} for ${item.quantity.toLocaleString('en-US')} ${item.uom === 'FT' ? 'ft' : 'ea'}`
              : '—'}
          </dd>
          <dt>Lead time</dt>
          <dd>
            {weeks(cell.leadTimeWeeks)}
            {cell.bid.leadTimeText && <span className="muted"> (quoted “{cell.bid.leadTimeText}”)</span>}
          </dd>
          {move && (
            <>
              <dt>{move.previousRound}</dt>
              <dd>
                {unitPrice(move.previousUnitPrice, item.uom)}, {weeks(move.previousLeadTimeWeeks)} <MoveBadge move={move} />
              </dd>
            </>
          )}
        </dl>
      </section>

      {(cell.flags.length > 0 || repeat) && (
        <section aria-labelledby="flags-h">
          <h3 id="flags-h">For the evaluator</h3>
          <ul className="flags">
            {repeat && (
              <li className="flag flag-deviation">
                Repeat deviation: {cell.vendor} also deviated on this line in {repeat.previousRound} ({repeat.previousDeviations.join(', ')}).
              </li>
            )}
            {cell.flags.map((f, i) => (
              <li key={i} className={`flag flag-${f.code}`}>
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="detail-actions">
        {onUndo ? (
          <button type="button" className="btn" onClick={onUndo}>
            Undo {cell.source === 'llm' ? 'accepted AI match' : cell.source === 'memory' ? 'match from memory' : 'reviewer match'}
          </button>
        ) : (
          <button type="button" className="btn" onClick={onSetAside}>
            Wrong match: send to review
          </button>
        )}
      </div>
    </div>
  );
}
