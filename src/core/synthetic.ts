import type { BidLine, CatalogItem } from './types.ts';
import { parseCatalog } from './csv.ts';
import { toCsv } from './csv.ts';

/**
 * Seeded generator for a large synthetic solicitation: roughly 250 distribution
 * SKUs and any number of vendors, each writing descriptions in one of four
 * house styles, quoting different units, skipping some lines and deviating on a
 * few. Every generated row records the SKU it was written for, so matcher
 * accuracy can be measured at scale.
 */

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2 ** 32;
  };
}

type Spec =
  | { kind: 'pm3'; kva: number; pri: [number, number]; sec: '208Y/120' | '480Y/277'; fluid: 'FR3' | 'MIN' }
  | { kind: 'pm1'; kva: number; sec: '120/240'; fluid: 'FR3' | 'MIN' }
  | { kind: 'oh1'; kva: number; pri: number }
  | { kind: 'co'; kv: number; amps: number }
  | { kind: 'arr'; mcov: number }
  | { kind: 'cbl'; kv: number; size: string; mat: 'AL' | 'CU'; ins: 100 | 133 }
  | { kind: 'bare'; code: 'RAVEN' | 'PENGUIN' | 'LINNET' | 'ORIOLE' | 'MERLIN' }
  | { kind: 'post'; kv: number }
  | { kind: 'rcl'; kv: number; amps: number }
  | { kind: 'mtr'; cls: number }
  | { kind: 'swg'; kv: number; ways: number }
  | { kind: 'elb'; kv: number; size: string };

const BARE: Record<string, { size: string; strand: string }> = {
  RAVEN: { size: '1/0', strand: '6/1' },
  PENGUIN: { size: '4/0', strand: '6/1' },
  LINNET: { size: '336.4', strand: '26/7' },
  ORIOLE: { size: '336.4', strand: '30/7' },
  MERLIN: { size: '336.4', strand: '18/1' },
};

function specs(): Spec[] {
  const out: Spec[] = [];
  for (const pri of [
    [12470, 7200],
    [4160, 2400],
  ] as [number, number][])
    for (const kva of [45, 75, 112.5, 150, 225, 300, 500, 750, 1000, 1500, 2000, 2500])
      for (const sec of ['208Y/120', '480Y/277'] as const) for (const fluid of ['FR3', 'MIN'] as const) out.push({ kind: 'pm3', kva, pri, sec, fluid });
  for (const kva of [25, 37.5, 50, 75, 100, 167]) for (const fluid of ['FR3', 'MIN'] as const) out.push({ kind: 'pm1', kva, sec: '120/240', fluid });
  for (const kva of [10, 15, 25, 37.5, 50, 75, 100, 167]) for (const pri of [7200, 7620]) out.push({ kind: 'oh1', kva, pri });
  for (const kv of [15, 27]) for (const amps of [100, 200]) out.push({ kind: 'co', kv, amps });
  for (const mcov of [5.1, 8.4, 10.2, 15.3, 22]) out.push({ kind: 'arr', mcov });
  for (const kv of [15, 25, 35])
    for (const size of ['1/0', '2/0', '4/0', '350', '500', '750', '1000'])
      for (const mat of ['AL', 'CU'] as const) for (const ins of [100, 133] as const) out.push({ kind: 'cbl', kv, size, mat, ins });
  for (const code of ['RAVEN', 'PENGUIN', 'LINNET', 'ORIOLE', 'MERLIN'] as const) out.push({ kind: 'bare', code });
  for (const kv of [15, 25, 35]) out.push({ kind: 'post', kv });
  for (const kv of [15, 27, 38]) for (const amps of [630, 800]) out.push({ kind: 'rcl', kv, amps });
  for (const cls of [100, 200, 320]) out.push({ kind: 'mtr', cls });
  for (const kv of [15, 25]) for (const ways of [3, 4, 5, 6]) out.push({ kind: 'swg', kv, ways });
  for (const kv of [15, 25]) for (const size of ['1/0', '2/0', '4/0']) out.push({ kind: 'elb', kv, size });
  return out;
}

const kcmil = (size: string) => (size.includes('/') ? `${size} AWG` : `${size} kcmil`);
const fmtKva = (kva: number) => String(kva);

function catalogText(s: Spec): string {
  switch (s.kind) {
    case 'pm3':
      return `Transformer, pad-mount, 3 phase, ${fmtKva(s.kva)} kVA, ${s.pri[0]}GrdY/${s.pri[1]} - ${s.sec}, loop feed, ${s.fluid === 'FR3' ? 'FR3 fluid' : 'mineral oil'}, DOE 2016`;
    case 'pm1':
      return `Transformer, pad-mount, single phase, ${fmtKva(s.kva)} kVA, 7200V primary, 120/240 secondary, loop feed, ${s.fluid === 'FR3' ? 'FR3 fluid' : 'mineral oil'}, DOE 2016`;
    case 'oh1':
      return `Transformer, pole-mount, single phase, ${fmtKva(s.kva)} kVA, ${s.pri}V primary, 120/240 secondary, mineral oil, DOE 2016`;
    case 'co':
      return `Fuse cutout, ${s.kv} kV, ${s.amps} A, polymer`;
    case 'arr':
      return `Surge arrester, distribution class, ${s.mcov} kV MCOV, polymer`;
    case 'cbl':
      return `Primary cable, URD, ${s.kv} kV, ${kcmil(s.size)} ${s.mat}, ${s.ins}% EPR insulation`;
    case 'bare':
      return `Bare conductor, ${BARE[s.code]!.size} ${BARE[s.code]!.size.includes('/') ? 'AWG' : 'kcmil'} ACSR ${BARE[s.code]!.strand} ${s.code[0]}${s.code.slice(1).toLowerCase()}`;
    case 'post':
      return `Line post insulator, polymer, ${s.kv} kV`;
    case 'rcl':
      return `Recloser, 3 phase, ${s.kv} kV, ${s.amps} A`;
    case 'mtr':
      return `Meter, AMI, form 2S, class ${s.cls}`;
    case 'swg':
      return `Pad-mount switchgear, ${s.kv} kV, 600 A, ${s.ways}-way`;
    case 'elb':
      return `Load-break elbow, ${s.kv} kV, 200 A, for ${kcmil(s.size)} cable`;
  }
}

type Style = 'abbr' | 'verbose' | 'oem' | 'erp';

/** A vendor's description of a spec, in its house style. `deviate` swaps one requirement for a value the RFP didn't ask for. */
function vendorText(s: Spec, style: Style, deviate: boolean): string {
  const kvaWord = (kva: number) => (style === 'verbose' && kva >= 1000 ? `${kva / 1000} MVA` : style === 'abbr' ? `${kva}KVA` : `${kva} kVA`);
  switch (s.kind) {
    case 'pm3': {
      const pri: [number, number] = deviate ? [13200, 7620] : s.pri;
      const priText =
        style === 'verbose' ? `${pri[0] / 1000} kV GrdY/${pri[1] / 1000} kV primary` : style === 'abbr' ? `${pri[0]}GY/${pri[1]}` : `${pri[0]}GRDY/${pri[1]}`;
      const fluid = s.fluid === 'FR3' ? (style === 'verbose' ? 'natural ester fluid' : 'FR3') : style === 'abbr' ? 'MIN OIL' : 'mineral oil';
      if (style === 'verbose') return `Three-phase pad-mounted transformer, ${kvaWord(s.kva)}, ${priText}, ${s.sec} V secondary, loop feed, ${fluid}, DOE 2016 compliant`;
      if (style === 'abbr') return `XFMR PADMT 3PH ${kvaWord(s.kva)} ${priText}-${s.sec} LOOP ${fluid} DOE16`;
      if (style === 'erp') return `Transformer, 3PH, padmount, ${kvaWord(s.kva)}, ${priText}, ${s.sec}, loop, ${fluid}, DOE 2016`;
      return `PAD MOUNT XFMR 3PH ${kvaWord(s.kva)} ${priText} ${s.sec} LOOP ${fluid.toUpperCase()} DOE 2016`;
    }
    case 'pm1': {
      const fluid = s.fluid === 'FR3' ? (style === 'verbose' ? 'natural ester fluid' : 'FR3') : style === 'abbr' ? 'MIN OIL' : 'mineral oil';
      if (style === 'verbose') return `Single-phase pad-mounted transformer, ${kvaWord(s.kva)}, 7.2 kV primary, 120/240 V, loop feed, ${fluid}, DOE 2016`;
      if (style === 'abbr') return `XFMR PADMT 1PH ${kvaWord(s.kva)} 7200V 120/240 LOOP ${fluid} DOE16`;
      return `PAD MOUNT XFMR 1PH ${kvaWord(s.kva)} 7200V 120/240 LOOP ${fluid.toUpperCase()} DOE 2016`;
    }
    case 'oh1': {
      if (style === 'verbose') return `Single-phase pole-mounted transformer, ${kvaWord(s.kva)}, ${s.pri / 1000} kV primary, 120/240 V, mineral oil, DOE 2016`;
      if (style === 'abbr') return `XFMR OH 1PH ${kvaWord(s.kva)} ${s.pri}V 120/240 MIN OIL DOE16`;
      return `POLE TYPE XFMR 1PH ${kvaWord(s.kva)} ${s.pri}V 120/240 MINERAL OIL DOE 2016`;
    }
    case 'co':
      return style === 'verbose' ? `Fuse cutout, ${s.kv} kV class, ${s.amps} A, polymer housing` : `CUTOUT ${s.kv}KV ${s.amps}A POLYMER`;
    case 'arr': {
      const mcov = deviate ? Math.round((s.mcov - 0.75) * 100) / 100 : s.mcov;
      return style === 'verbose' ? `Distribution-class surge arrester, ${mcov} kV MCOV, polymer` : `ARRESTER DIST ${mcov}KV MCOV POLYMER`;
    }
    case 'cbl': {
      const mat = style === 'verbose' ? (s.mat === 'AL' ? 'aluminum' : 'copper') : s.mat;
      return style === 'verbose'
        ? `${s.kv} kV URD primary cable, ${kcmil(s.size)} ${mat}, ${s.ins}% insulation, EPR`
        : `CABLE ${s.kv}KV ${s.size.includes('/') ? s.size : `${s.size} KCMIL`} ${mat} ${s.ins}% EPR URD`;
    }
    case 'bare': {
      const b = BARE[s.code]!;
      return style === 'verbose'
        ? `Bare ACSR conductor ${b.size} ${b.size.includes('/') ? 'AWG' : 'kcmil'} ${b.strand} (${s.code[0]}${s.code.slice(1).toLowerCase()})`
        : `${b.size} ACSR ${b.strand} ${s.code}`;
    }
    case 'post':
      return style === 'verbose' ? `Polymer line post insulator, ${s.kv} kV` : `INSULATOR LINE POST ${s.kv}KV POLYMER`;
    case 'rcl': {
      const amps = deviate ? 560 : s.amps;
      return style === 'verbose' ? `Three-phase recloser, ${s.kv} kV, ${amps} A continuous` : `RECLOSER 3PH ${s.kv}KV ${amps}A`;
    }
    case 'mtr':
      return style === 'verbose' ? `AMI residential meter, Form 2S, Class ${s.cls}, 240 V` : `METER AMI FM2S CL${s.cls}`;
    case 'swg':
      return style === 'verbose' ? `${s.kv} kV pad-mounted switchgear, 600 A, ${s.ways}-way` : `SWGR PADMT ${s.kv}KV 600A ${s.ways}-WAY`;
    case 'elb':
      return style === 'verbose' ? `Load-break elbow, ${s.kv} kV, 200 A, ${kcmil(s.size)}` : `ELBOW LB ${s.kv}KV 200A ${s.size}`;
  }
}

function basePrice(s: Spec): number {
  switch (s.kind) {
    case 'pm3':
      return 9000 + s.kva * 55 + (s.fluid === 'FR3' ? 1200 : 0);
    case 'pm1':
      return 2500 + s.kva * 70;
    case 'oh1':
      return 900 + s.kva * 45;
    case 'co':
      return 90 + s.amps * 0.2 + s.kv;
    case 'arr':
      return 60 + s.mcov * 4;
    case 'cbl':
      return (s.mat === 'CU' ? 2.2 : 1) * (1.5 + (s.size.includes('/') ? 1 : Number(s.size) / 250)) * (s.kv / 15) * (s.ins === 133 ? 1.12 : 1);
    case 'bare':
      return { RAVEN: 0.55, PENGUIN: 0.95, LINNET: 1.4, ORIOLE: 1.5, MERLIN: 1.3 }[s.code];
    case 'post':
      return 50 + s.kv * 1.2;
    case 'rcl':
      return 36000 + s.kv * 300 + s.amps * 5;
    case 'mtr':
      return 110 + s.cls * 0.1;
    case 'swg':
      return 40000 + s.ways * 3500 + s.kv * 200;
    case 'elb':
      return 70 + s.kv * 0.5;
  }
}

const isCable = (s: Spec) => s.kind === 'cbl' || s.kind === 'bare';

export interface SyntheticTruth {
  /** `${vendor}#${row}` → catalog id the row was written for. */
  lines: Map<string, string>;
  /** `${vendor}#${row}` of rows written with a deliberate deviation. */
  deviated: Set<string>;
}

export interface SyntheticSolicitation {
  catalog: CatalogItem[];
  bids: BidLine[];
  truth: SyntheticTruth;
}

/** Generate a solicitation with `vendors` vendors. Same seed, same output. */
export function generateSolicitation(vendors: number, seed = 2027, deviationRate = 0.03): SyntheticSolicitation {
  const rand = rng(seed);
  const all = specs();
  const rows: (string | number)[][] = [['Line', 'Stock Code', 'Description', 'Qty', 'UOM']];
  all.forEach((s, i) => {
    const ft = isCable(s);
    rows.push([i + 1, `SKU-${String(i + 1).padStart(3, '0')}`, catalogText(s), ft ? 1000 * (2 + Math.floor(rand() * 20)) : 1 + Math.floor(rand() * 60), ft ? 'FT' : 'EA']);
  });
  const catalog = parseCatalog(toCsv(rows));

  const styles: Style[] = ['abbr', 'verbose', 'oem', 'erp'];
  const bids: BidLine[] = [];
  const truth: SyntheticTruth = { lines: new Map(), deviated: new Set() };
  for (let v = 0; v < vendors; v++) {
    const vendor = `Vendor ${String(v + 1).padStart(2, '0')}`;
    const style = styles[v % styles.length]!;
    const coverage = 0.75 + rand() * 0.25;
    const margin = 0.9 + rand() * 0.2;
    // Fisher-Yates, so the order depends only on the seed and not on an engine's sort.
    const order = all.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    let row = 0;
    for (const i of order) {
      if (rand() > coverage) continue;
      const s = all[i]!;
      const item = catalog[i]!;
      // Only deviations that don't turn the line into a different catalog SKU, so the label stays true.
      const canDeviate = s.kind === 'pm3' || s.kind === 'arr' || s.kind === 'rcl';
      const deviate = canDeviate && rand() < deviationRate;
      const unit = basePrice(s) * margin * (0.95 + rand() * 0.1);
      row++;
      const perThousand = isCable(s) && style === 'verbose';
      bids.push({
        vendor,
        row,
        buyerLineRef: style === 'abbr' ? item.line : null,
        description: vendorText(s, style, deviate),
        quantity: perThousand ? item.quantity / 1000 : item.quantity,
        uomText: isCable(s) ? (perThousand ? 'M ft' : 'FT') : 'EA',
        unitPriceText: `$${(perThousand ? unit * 1000 : unit).toFixed(2)}`,
        leadTimeText: `${4 + Math.floor(rand() * 50)} weeks`,
        noBid: false,
      });
      truth.lines.set(`${vendor}#${row}`, item.id);
      if (deviate) truth.deviated.add(`${vendor}#${row}`);
    }
  }
  return { catalog, bids, truth };
}
