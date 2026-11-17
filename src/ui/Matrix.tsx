import { cellStatus, type CellStatus } from '../core/level.ts';
import type { PriceMove } from '../core/memory.ts';
import type { LevelingResult, MatchSource } from '../core/types.ts';
import { dollars, percent, unitPrice, weeks } from './format.ts';

const SOURCE_LABEL: Record<Exclude<MatchSource, 'deterministic'>, string> = { llm: 'AI match', reviewer: 'Reviewer', memory: 'From memory' };

export interface CellRef {
  itemId: string;
  vendor: string;
}

const STATUS_LABEL: Record<CellStatus, string> = {
  compliant: 'Meets spec',
  clarify: 'Needs clarification',
  deviation: 'Deviates from spec',
  no_bid: 'No bid',
};

export function StatusBadge({ status }: { status: CellStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Items × vendors, with normalized prices, lead times and spec status. The lowest eligible price per row is marked. */
export function MoveBadge({ move }: { move: PriceMove | null }) {
  if (!move || Math.abs(move.change) < 0.005) return null;
  const up = move.change > 0;
  return (
    <span className={`move ${up ? 'move-up' : 'move-down'}`} title={`${move.previousRound}: ${up ? 'up' : 'down'} ${percent(Math.abs(move.change))}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'up' : 'down'}</span> {(Math.abs(move.change) * 100).toFixed(1)}%
    </span>
  );
}

export function Matrix({
  result,
  selected,
  onSelect,
  moveOf,
}: {
  result: LevelingResult;
  selected: CellRef | null;
  onSelect: (ref: CellRef) => void;
  moveOf: (itemId: string, vendor: string, unitPrice: number) => PriceMove | null;
}) {
  // A vendor line waiting for review may belong in an empty cell; don't call that cell a no-bid.
  const inReview = new Set<string>();
  for (const u of result.unresolved) {
    const top = u.candidates[0]?.score;
    for (const c of u.candidates) if (c.score === top) inReview.add(`${c.itemId}#${u.bid.vendor}`);
  }

  return (
    <div className="matrix-scroll" role="region" aria-label="Leveling matrix" tabIndex={0}>
      <table className="matrix">
        <thead>
          <tr>
            <th scope="col" className="col-item">
              RFP line
            </th>
            {result.vendors.map((v) => (
              <th scope="col" key={v}>
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.catalog.map((item) => {
            const row = result.cells[item.id] ?? {};
            const eligible = result.vendors
              .map((v) => row[v])
              .filter((c) => c && c.extendedPrice !== null && cellStatus(c) !== 'deviation');
            const lowest = eligible.length > 0 ? Math.min(...eligible.map((c) => c!.extendedPrice!)) : null;
            return (
              <tr key={item.id}>
                <th scope="row" className="col-item">
                  <span className="item-line">
                    {item.line}. {item.id}
                  </span>
                  <span className="item-desc">{item.description}</span>
                  <span className="item-qty">
                    {item.quantity.toLocaleString('en-US')} {item.uom === 'FT' ? 'ft' : 'ea'}
                  </span>
                </th>
                {result.vendors.map((vendor) => {
                  const cell = row[vendor];
                  const status = cellStatus(cell);
                  const isSelected = selected?.itemId === item.id && selected.vendor === vendor;
                  const isLowest = cell !== undefined && lowest !== null && cell.extendedPrice === lowest && status !== 'deviation';
                  if (!cell) {
                    return (
                      <td key={vendor} className="cell cell-empty">
                        {inReview.has(`${item.id}#${vendor}`) ? (
                          <a className="badge badge-clarify" href="#review-h">
                            Line in review
                          </a>
                        ) : (
                          <StatusBadge status="no_bid" />
                        )}
                      </td>
                    );
                  }
                  return (
                    <td key={vendor} className={`cell cell-${status}${isSelected ? ' is-selected' : ''}`}>
                      <button
                        type="button"
                        className="cell-button"
                        aria-pressed={isSelected}
                        aria-label={`${item.id} from ${vendor}: ${STATUS_LABEL[status]}${cell.extendedPrice !== null ? `, ${dollars(cell.extendedPrice)}` : ''}. Show evidence.`}
                        onClick={() => onSelect({ itemId: item.id, vendor })}
                      >
                        <span className="cell-price">
                          {cell.extendedPrice !== null ? dollars(cell.extendedPrice) : 'Price ?'}
                          {isLowest && <span className="lowest" title="Lowest eligible price on this line">Low</span>}
                        </span>
                        <span className="cell-meta">
                          {cell.price ? unitPrice(cell.price.unitPrice, item.uom) : '—'} · {weeks(cell.leadTimeWeeks)}
                        </span>
                        <span className="cell-tags">
                          <StatusBadge status={status} />
                          {cell.price && <MoveBadge move={moveOf(item.id, vendor, cell.price.unitPrice)} />}
                        </span>
                        {cell.source !== 'deterministic' && <span className="source-tag">{SOURCE_LABEL[cell.source]}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
