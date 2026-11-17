import type { AwardOptions, AwardScenario } from '../core/award.ts';
import type { CatalogItem } from '../core/types.ts';
import { dollars, percent } from './format.ts';

const SHARE_OPTIONS = [null, 0.4, 0.5, 0.6, 0.75] as const;

export function AwardControls({ options, onChange }: { options: AwardOptions; onChange: (o: AwardOptions) => void }) {
  return (
    <fieldset className="controls">
      <legend className="sr-only">Award rules</legend>
      <label className="check">
        <input
          type="checkbox"
          checked={options.includeClarifications}
          onChange={(e) => onChange({ ...options, includeClarifications: e.target.checked })}
        />
        Count bids that need clarification
      </label>
      <label className="field">
        <span>Latest delivery</span>
        <span className="input-unit">
          <input
            type="number"
            min={0}
            max={200}
            inputMode="numeric"
            placeholder="Any"
            value={options.maxLeadTimeWeeks ?? ''}
            onChange={(e) => onChange({ ...options, maxLeadTimeWeeks: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
          weeks
        </span>
      </label>
      <label className="field">
        <span>Cap any one supplier at</span>
        <select
          value={options.maxVendorShare === null ? '' : String(options.maxVendorShare)}
          onChange={(e) => onChange({ ...options, maxVendorShare: e.target.value === '' ? null : Number(e.target.value) })}
        >
          {SHARE_OPTIONS.map((s) => (
            <option key={String(s)} value={s === null ? '' : String(s)}>
              {s === null ? 'No cap' : `${Math.round(s * 100)}% of spend`}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

export function Scenarios({
  scenarios,
  catalog,
  onExport,
  onRecommend,
}: {
  scenarios: AwardScenario[];
  catalog: CatalogItem[];
  onExport: (s: AwardScenario) => void;
  onRecommend: (s: AwardScenario) => void;
}) {
  const lowest = scenarios.find((s) => s.key === 'lowest');
  return (
    <div className="scenarios">
      {scenarios.map((s) => {
        const complete = s.uncovered.length === 0 && !s.infeasible;
        const delta = lowest && complete && s.key !== 'lowest' && lowest.uncovered.length === 0 ? s.total - lowest.total : null;
        return (
          <article key={s.key} className={`scenario${complete ? '' : ' is-partial'}`}>
            <header>
              <h3>{s.title}</h3>
              {s.infeasible ? (
                <p className="scenario-total muted">Not possible</p>
              ) : (
                <p className="scenario-total">
                  {dollars(s.total)}
                  {delta !== null && (
                    <span className="delta">
                      {delta === 0 ? ' same as lowest' : ` +${dollars(delta)} (${((delta / lowest!.total) * 100).toFixed(2)}%)`}
                    </span>
                  )}
                </p>
              )}
            </header>
            <p className="scenario-desc">{s.infeasible ?? s.description}</p>
            {!s.infeasible && (
              <>
                <div className="share-bar" role="img" aria-label={s.shares.map((x) => `${x.vendor} ${percent(x.share)}`).join(', ')}>
                  {s.shares.map((x, i) => (
                    <span key={x.vendor} className={`share share-${i % 4}`} style={{ width: `${x.share * 100}%` }} />
                  ))}
                </div>
                <ul className="share-legend">
                  {s.shares.map((x, i) => (
                    <li key={x.vendor}>
                      <span className={`swatch share-${i % 4}`} aria-hidden="true" />
                      {x.vendor} {percent(x.share)} · {dollars(x.amount)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {s.uncovered.length > 0 && !s.infeasible && (
              <p className="uncovered">
                Not covered: {s.uncovered.map((id) => `${catalog.find((i) => i.id === id)?.line}. ${id}`).join(', ')}
              </p>
            )}
            {!s.infeasible && s.awards.length > 0 && (
              <div className="row">
                <button type="button" className="btn btn-small btn-primary" onClick={() => onRecommend(s)}>
                  Recommendation
                </button>
                <button type="button" className="btn btn-small" onClick={() => onExport(s)}>
                  CSV
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
