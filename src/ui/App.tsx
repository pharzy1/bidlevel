import { useCallback, useEffect, useMemo, useState } from 'react';
import { awardScenarios, type AwardOptions, type AwardScenario } from '../core/award.ts';
import { CsvFormatError, parseBidRows, parseBidSheet, parseCatalog, toCsv } from '../core/csv.ts';
import { cellStatus, level, type Resolution } from '../core/level.ts';
import { closeRound, EMPTY_MEMORY, parseMemory, priceMove, recall, type ProcurementMemory } from '../core/memory.ts';
import { buildRecommendation, type Recommendation } from '../core/report.ts';
import { generateSolicitation } from '../core/synthetic.ts';
import type { BidLine, CatalogItem, UnresolvedLine } from '../core/types.ts';
import { readXlsxRows, XlsxError } from '../core/xlsx.ts';
import { buildResolveRequest, type Suggestion } from '../llm/suggestion.ts';
import { AwardControls, Scenarios } from './Awards.tsx';
import { CellDetail } from './CellDetail.tsx';
import { Clarifications } from './Clarifications.tsx';
import { vendorNameFromFile } from './format.ts';
import { Matrix, type CellRef } from './Matrix.tsx';
import { Report } from './Report.tsx';
import { lineKey, ReviewQueue, type SuggestionState } from './ReviewQueue.tsx';

type DatasetKey = 'q4' | 'q1' | 'scale' | 'upload';

interface Dataset {
  key: DatasetKey;
  /** The procurement round, used as the memory key: "Q4 2026". */
  round: string;
  label: string;
  catalog: CatalogItem[];
  bids: BidLine[];
}

const MEMORY_KEY = 'bidlevel-memory-v1';

function loadMemory(): ProcurementMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    return (raw && parseMemory(JSON.parse(raw))) || EMPTY_MEMORY;
  } catch {
    return EMPTY_MEMORY;
  }
}

function saveMemory(m: ProcurementMemory) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
  } catch {
    // Storage can be unavailable (private windows). Memory still works for this session.
  }
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${path}`);
  if (!res.ok) throw new Error(`Couldn't load the sample file ${path}.`);
  return res.text();
}

async function fetchRows(path: string): Promise<string[][]> {
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${path}`);
  if (!res.ok) throw new Error(`Couldn't load the sample file ${path}.`);
  return readXlsxRows(await res.arrayBuffer());
}

async function loadDataset(key: Exclude<DatasetKey, 'upload'>): Promise<Dataset> {
  if (key === 'scale') {
    const { catalog, bids } = generateSolicitation(22);
    return {
      key,
      round: 'Stress test',
      label: `Stress test: ${catalog.length} SKUs × 22 vendors (${bids.length.toLocaleString('en-US')} priced lines, generated)`,
      catalog,
      bids,
    };
  }
  const catalog = parseCatalog(await fetchText('catalog.csv'));
  if (key === 'q4') {
    const sheets = await Promise.all(
      (['a', 'b', 'c'] as const).map(async (v) => parseBidSheet(`Vendor ${v.toUpperCase()}`, await fetchText(`vendor-${v}.csv`))),
    );
    return { key, round: 'Q4 2026', label: 'Q4 2026 distribution materials re-bid: 3 vendors, CSV (synthetic data)', catalog, bids: sheets.flat() };
  }
  const sheets = await Promise.all([
    ...(['a', 'b', 'c'] as const).map(async (v) => parseBidSheet(`Vendor ${v.toUpperCase()}`, await fetchText(`q1-2027/vendor-${v}.csv`))),
    fetchRows('q1-2027/vendor-d.xlsx').then((rows) => parseBidRows('Vendor D', rows)),
  ]);
  return { key, round: 'Q1 2027', label: 'Q1 2027 re-bid: 4 vendors, CSV and Excel (synthetic data)', catalog, bids: sheets.flat() };
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readSheet(file: File): Promise<string[][] | string> {
  return /\.xlsx$/i.test(file.name) ? readXlsxRows(await file.arrayBuffer()) : file.text();
}

const TABS: { key: Exclude<DatasetKey, 'upload'>; label: string }[] = [
  { key: 'q4', label: 'Q4 2026 re-bid' },
  { key: 'q1', label: 'Q1 2027 re-bid' },
  { key: 'scale', label: 'At scale: 22 vendors' },
];

export function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, SuggestionState | undefined>>({});
  const [options, setOptions] = useState<AwardOptions>({ includeClarifications: true, maxLeadTimeWeeks: null, maxVendorShare: 0.5 });
  const [catalogFile, setCatalogFile] = useState<File | null>(null);
  const [vendorFiles, setVendorFiles] = useState<File[]>([]);
  const [uploadRound, setUploadRound] = useState('');
  const [memory, setMemory] = useState<ProcurementMemory>(loadMemory);
  const [notice, setNotice] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);

  const reset = useCallback((d: Dataset) => {
    setData(d);
    setResolutions([]);
    setSuggestions({});
    setSelected(null);
    setError(null);
    setNotice(null);
    setOptions((o) => ({ ...o, maxVendorShare: d.key === 'scale' ? 0.3 : o.maxVendorShare === 0.3 ? 0.5 : o.maxVendorShare }));
  }, []);

  const open = useCallback(
    (key: Exclude<DatasetKey, 'upload'>) => {
      setLoading(true);
      loadDataset(key)
        .then(reset, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [reset],
  );

  useEffect(() => {
    loadDataset('q4')
      .then(reset, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [reset]);

  const updateMemory = (m: ProcurementMemory) => {
    setMemory(m);
    saveMemory(m);
  };

  const recalled = useMemo(() => (data ? recall(memory, data.bids, new Set(data.catalog.map((i) => i.id))) : []), [data, memory]);
  const result = useMemo(() => (data ? level(data.catalog, data.bids, [...recalled, ...resolutions]) : null), [data, recalled, resolutions]);
  const scenarios = useMemo(() => (result ? awardScenarios(result, options) : []), [result, options]);
  const moveOf = useCallback(
    (itemId: string, vendor: string, unitPrice: number) => (data ? priceMove(memory, vendor, itemId, data.round, unitPrice) : null),
    [data, memory],
  );

  const stats = useMemo(() => {
    if (!result || !data) return null;
    let matched = 0;
    let compliant = 0;
    let deviations = 0;
    let clarify = 0;
    let fromMemory = 0;
    for (const item of result.catalog) {
      for (const v of result.vendors) {
        const c = result.cells[item.id]?.[v];
        if (!c) continue;
        matched++;
        if (c.source === 'memory') fromMemory++;
        const s = cellStatus(c);
        if (s === 'compliant') compliant++;
        else if (s === 'deviation') deviations++;
        else if (s === 'clarify') clarify++;
      }
    }
    return { lines: data.bids.length, matched, compliant, deviations, clarify, fromMemory, review: result.unresolved.length, noBids: result.noBids.length };
  }, [result, data]);

  async function levelUploads() {
    if (!catalogFile || vendorFiles.length === 0) {
      setError('Choose the RFP line list and at least one vendor price sheet.');
      return;
    }
    try {
      const cat = await readSheet(catalogFile);
      const catalog = parseCatalog(typeof cat === 'string' ? cat : toCsv(cat));
      const sheets = await Promise.all(
        vendorFiles.map(async (f) => {
          const content = await readSheet(f);
          const vendor = vendorNameFromFile(f.name);
          return typeof content === 'string' ? parseBidSheet(vendor, content) : parseBidRows(vendor, content);
        }),
      );
      reset({
        key: 'upload',
        round: uploadRound.trim() || 'Uploaded round',
        label: `${catalogFile.name} with ${vendorFiles.length} price sheet${vendorFiles.length === 1 ? '' : 's'}`,
        catalog,
        bids: sheets.flat(),
      });
    } catch (e) {
      setError(e instanceof CsvFormatError || e instanceof XlsxError ? e.message : `Couldn't read those files: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function resolve(line: UnresolvedLine, itemId: string | null, source: 'llm' | 'reviewer') {
    setResolutions((rs) => [...rs.filter((r) => !(r.vendor === line.bid.vendor && r.row === line.bid.row)), { vendor: line.bid.vendor, row: line.bid.row, itemId, source }]);
    if (itemId) setSelected({ itemId, vendor: line.bid.vendor });
  }

  async function ask(line: UnresolvedLine) {
    if (!data) return;
    const key = lineKey(line.bid.vendor, line.bid.row);
    setSuggestions((s) => ({ ...s, [key]: { state: 'loading' } }));
    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildResolveRequest(line, data.catalog)),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string } & Partial<Suggestion>;
      if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
      setSuggestions((s) => ({ ...s, [key]: { state: 'done', suggestion: body as Suggestion } }));
    } catch (e) {
      const message = e instanceof TypeError ? 'Claude suggestions need the BidLevel server. Run it with ANTHROPIC_API_KEY set.' : e instanceof Error ? e.message : String(e);
      setSuggestions((s) => ({ ...s, [key]: { state: 'error', message } }));
    }
  }

  function closeThisRound() {
    if (!data || !result) return;
    updateMemory(closeRound(memory, data.round, result, resolutions, data.bids, new Date().toISOString().slice(0, 10)));
    const decisions = resolutions.filter((r) => r.itemId && (r.source === 'reviewer' || r.source === 'llm')).length;
    setNotice(
      `Saved ${data.round} to memory: ${decisions} reviewer decision${decisions === 1 ? '' : 's'} and this round’s prices. ${data.key === 'q4' ? 'Open the Q1 2027 re-bid to see them used.' : ''}`,
    );
  }

  async function importMemory(file: File) {
    try {
      const m = parseMemory(JSON.parse(await file.text()));
      if (!m) throw new Error('not a memory file');
      updateMemory(m);
      setNotice(`Loaded memory with ${m.rounds.length} round${m.rounds.length === 1 ? '' : 's'}.`);
    } catch {
      setError('That file isn’t a BidLevel memory export.');
    }
  }

  function exportMatrix() {
    if (!result) return;
    const rows: (string | number | null)[][] = [
      ['Line', 'Stock code', 'Description', 'Qty', 'UOM', ...result.vendors.flatMap((v) => [`${v} unit price`, `${v} extended`, `${v} lead (wk)`, `${v} status`, `${v} notes`])],
    ];
    for (const item of result.catalog) {
      rows.push([
        item.line,
        item.id,
        item.description,
        item.quantity,
        item.uom,
        ...result.vendors.flatMap((v) => {
          const c = result.cells[item.id]?.[v];
          if (!c) return [null, null, null, 'no bid', null];
          return [c.price?.unitPrice ?? null, c.extendedPrice, c.leadTimeWeeks, cellStatus(c), c.flags.map((f) => f.message).join(' | ')];
        }),
      ]);
    }
    download('bid-leveling.csv', toCsv(rows), 'text/csv;charset=utf-8');
  }

  function exportAward(s: AwardScenario) {
    if (!result) return;
    const rows: (string | number | null)[][] = [['Line', 'Stock code', 'Awarded to', 'Extended price']];
    for (const a of s.awards) rows.push([result.catalog.find((i) => i.id === a.itemId)?.line ?? null, a.itemId, a.vendor, a.extendedPrice]);
    for (const id of s.uncovered) rows.push([result.catalog.find((i) => i.id === id)?.line ?? null, id, 'NOT COVERED', null]);
    rows.push([null, null, 'Total', s.total]);
    download(`award-${s.key.replace(/[^a-z0-9]+/gi, '-')}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  }

  const selectedCell = selected && result ? result.cells[selected.itemId]?.[selected.vendor] : undefined;
  const selectedItem = selected && result ? result.catalog.find((i) => i.id === selected.itemId) : undefined;
  const roundClosed = data ? memory.rounds.some((r) => r.round === data.round) : false;
  const hasEarlierRound = data ? memory.rounds.some((r) => r.round !== data.round && r.round !== 'Stress test') : false;

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>BidLevel</h1>
          <p className="tagline">Line-item bid leveling for utility equipment RFPs. Every match cites the vendor’s own words.</p>
        </div>
        <details className="upload">
          <summary className="btn">Use your own files</summary>
          <div className="upload-panel">
            <label className="field">
              <span>RFP line list (CSV or Excel)</span>
              <input type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => setCatalogFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="field">
              <span>Vendor price sheets (CSV or Excel, one per vendor, named after the vendor)</span>
              <input type="file" accept=".csv,.xlsx,text/csv" multiple onChange={(e) => setVendorFiles([...(e.target.files ?? [])])} />
            </label>
            <label className="field">
              <span>Round name, for memory (e.g. “Q2 2027”)</span>
              <input type="text" value={uploadRound} onChange={(e) => setUploadRound(e.target.value)} placeholder="Uploaded round" />
            </label>
            <button type="button" className="btn btn-primary" onClick={levelUploads}>
              Level these bids
            </button>
            <p className="hint">Files are read in your browser. Nothing is uploaded unless you ask Claude about a line.</p>
          </div>
        </details>
      </header>

      <nav className="tabs" aria-label="Sample solicitations">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab${data?.key === t.key ? ' is-active' : ''}`} aria-current={data?.key === t.key ? 'page' : undefined} onClick={() => open(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner banner-info" role="status">
          {notice}
          {data?.key === 'q4' && roundClosed && (
            <button type="button" className="btn btn-small" onClick={() => open('q1')}>
              Open Q1 2027
            </button>
          )}
        </p>
      )}
      {data?.key === 'q1' && !hasEarlierRound && (
        <p className="banner banner-info">
          Memory is empty. Resolve the review queue in the Q4 2026 re-bid and save it to memory, then come back: this round’s repeat lines get matched
          automatically and every price shows its change.
        </p>
      )}
      {loading && <p className="muted">Loading…</p>}

      {data && result && stats && (
        <main>
          <p className="dataset">{data.label}</p>

          <ul className="stats" aria-label="Summary">
            <li>
              <strong>{stats.matched.toLocaleString('en-US')}</strong> of {stats.lines.toLocaleString('en-US')} bid lines matched
            </li>
            <li className="stat-compliant">
              <strong>{stats.compliant.toLocaleString('en-US')}</strong> meet spec
            </li>
            <li className="stat-deviation">
              <strong>{stats.deviations}</strong> deviate
            </li>
            <li className="stat-clarify">
              <strong>{stats.clarify}</strong> need clarification
            </li>
            <li className="stat-review">
              <strong>{stats.review}</strong> waiting for review
            </li>
            {stats.fromMemory > 0 && (
              <li className="stat-memory">
                <strong>{stats.fromMemory}</strong> matched from memory
              </li>
            )}
            <li>
              <strong>{stats.noBids}</strong> no-bid
            </li>
          </ul>

          <div className="workspace">
            <section className="panel matrix-panel" aria-labelledby="matrix-h">
              <div className="panel-head">
                <h2 id="matrix-h">Leveling matrix</h2>
                <button type="button" className="btn btn-small" onClick={exportMatrix}>
                  Download CSV
                </button>
              </div>
              <p className="hint">
                Prices are converted to the RFP’s unit and extended at the requested quantity.{hasEarlierRound ? ' Arrows show the change since the vendor’s last round.' : ''} Select a cell to see the evidence.
              </p>
              <Matrix result={result} selected={selected} onSelect={setSelected} moveOf={moveOf} />
            </section>

            <aside className="panel detail-panel" aria-label="Evidence" aria-live="polite">
              {selectedCell && selectedItem ? (
                <CellDetail
                  item={selectedItem}
                  cell={selectedCell}
                  move={selectedCell.price ? moveOf(selectedItem.id, selectedCell.vendor, selectedCell.price.unitPrice) : null}
                  onSetAside={() => {
                    setResolutions((rs) => [...rs, { vendor: selectedCell.vendor, row: selectedCell.bid.row, itemId: null, source: 'reviewer' }]);
                    setSelected(null);
                  }}
                  onUndo={
                    selectedCell.source === 'deterministic'
                      ? null
                      : () => {
                          setResolutions((rs) => [
                            ...rs.filter((r) => !(r.vendor === selectedCell.vendor && r.row === selectedCell.bid.row)),
                            ...(selectedCell.source === 'memory' ? [{ vendor: selectedCell.vendor, row: selectedCell.bid.row, itemId: null, source: 'reviewer' as const }] : []),
                          ]);
                          setSelected(null);
                        }
                  }
                />
              ) : (
                <div className="detail-empty">
                  <h2>Evidence</h2>
                  <p>Select a price in the matrix to see the vendor’s line with each requirement checked against their exact words.</p>
                </div>
              )}
            </aside>
          </div>

          <section className="panel" aria-labelledby="review-h">
            <h2 id="review-h">Waiting for review ({result.unresolved.length})</h2>
            <p className="hint">
              The matcher leaves a line here instead of guessing. Ask Reviewer suggests a match, but only with quotes that appear word for word in the vendor’s
              line, and a person accepts it. Decisions are remembered for the next round.
            </p>
            <ReviewQueue lines={result.unresolved.slice(0, 60)} catalog={result.catalog} suggestions={suggestions} onAsk={ask} onResolve={resolve} />
            {result.unresolved.length > 60 && <p className="hint">Showing the first 60 of {result.unresolved.length}.</p>}
          </section>

          <section className="panel" aria-labelledby="clarify-h">
            <h2 id="clarify-h">Clarification requests</h2>
            <p className="hint">One letter per vendor covering every deviation, unstated requirement, unreadable lead time and ambiguous row, each quoting their own price sheet.</p>
            <Clarifications result={result} rfpLabel={`${data.round} distribution materials re-bid`} />
          </section>

          <section className="panel" aria-labelledby="award-h">
            <h2 id="award-h">Award scenarios</h2>
            <p className="hint">Bids that deviate from spec are never awarded. Change the rules to see what each one costs, then open a recommendation to print or save.</p>
            <AwardControls options={options} onChange={setOptions} />
            <Scenarios
              scenarios={scenarios}
              catalog={result.catalog}
              onExport={exportAward}
              onRecommend={(s) => setRecommendation(buildRecommendation(result, s, scenarios, options, resolutions))}
            />
          </section>

          <section className="panel" aria-labelledby="memory-h">
            <h2 id="memory-h">Procurement memory</h2>
            <p className="hint">
              Closing a round saves its reviewer decisions and prices. Next round, lines a reviewer already resolved are matched automatically, and every price
              shows how it moved. Memory is kept in this browser; export it to share with your team.
            </p>
            <div className="memory">
              <dl className="facts">
                <dt>Rounds saved</dt>
                <dd>{memory.rounds.length > 0 ? memory.rounds.map((r) => `${r.round} (${r.closedOn})`).join(', ') : 'None yet'}</dd>
                <dt>Decisions</dt>
                <dd>{memory.decisions.length}</dd>
                <dt>Prices</dt>
                <dd>{memory.prices.length.toLocaleString('en-US')}</dd>
              </dl>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={closeThisRound}>
                  {roundClosed ? `Update ${data.round} in memory` : `Close ${data.round} and save to memory`}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={memory.rounds.length === 0}
                  onClick={() => download('bidlevel-memory.json', JSON.stringify(memory, null, 2), 'application/json')}
                >
                  Export
                </button>
                <label className="btn">
                  Import
                  <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && importMemory(e.target.files[0])} />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={memory.rounds.length === 0}
                  onClick={() => {
                    updateMemory(EMPTY_MEMORY);
                    setNotice('Memory cleared.');
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </section>
        </main>
      )}

      {recommendation && data && <Report rec={recommendation} rfpLabel={`${data.round} distribution materials re-bid`} onClose={() => setRecommendation(null)} />}

      <footer className="footer">
        <p>Independent project, not affiliated with any company. The sample RFPs and price sheets are synthetic and describe no real buyer or supplier.</p>
      </footer>
    </div>
  );
}
