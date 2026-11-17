import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBidSheet, parseCatalog } from '../src/core/csv.ts';
import type { Truth } from '../src/core/evaluate.ts';

const dir = fileURLToPath(new URL('../public/samples/', import.meta.url));
const read = (name: string) => readFileSync(dir + name, 'utf8');

export function loadSample() {
  const catalog = parseCatalog(read('catalog.csv'));
  const bids = [
    ...parseBidSheet('Vendor A', read('vendor-a.csv')),
    ...parseBidSheet('Vendor B', read('vendor-b.csv')),
    ...parseBidSheet('Vendor C', read('vendor-c.csv')),
  ];
  const truth = JSON.parse(read('truth.json')) as Truth;
  return { catalog, bids, truth };
}
