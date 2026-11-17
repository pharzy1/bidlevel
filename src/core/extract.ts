import type { AttributeName, AttributeValue, EquipmentKind, ExtractedAttribute } from './types.ts';

/**
 * Deterministic attribute extraction from a free-text line description.
 *
 * Every attribute carries the exact span it was read from, so a reviewer can
 * see why the leveler believes a vendor offered what it says they offered.
 * Values are canonicalized so different vendor spellings compare equal:
 * "12.47kV GrdY/7.2kV", "12470GY/7200" and "12470Y/7200" all become
 * "12470GrdY/7200".
 */

interface Hit {
  value: AttributeValue;
  start: number;
  end: number;
}

function span(text: string, start: number, end: number) {
  return { quote: text.slice(start, end), start, end };
}

function firstMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  return re.exec(text);
}

function allMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  return [...text.matchAll(re)];
}

const KIND_PATTERNS: { kind: EquipmentKind; pattern: RegExp }[] = [
  { kind: 'loadbreak_elbow', pattern: /\b(?:load[\s-]?break\s+)?elbows?\b|\bLBE\b/i },
  { kind: 'padmount_switchgear', pattern: /\bswitch\s*gear\b|\bSWGR\b|\bpad[\s-]?mount(?:ed)?\s+switch(?:es)?\b/i },
  { kind: 'meter', pattern: /\bmeters?\b|\bAMI\b/i },
  { kind: 'recloser', pattern: /\breclosers?\b|\bRECL\b/i },
  { kind: 'surge_arrester', pattern: /\barrest[eo]rs?\b|\bsurge\b/i },
  { kind: 'fuse_cutout', pattern: /\bcut[\s-]?outs?\b|\bC\/O\b/i },
  { kind: 'post_insulator', pattern: /\binsulators?\b|\bline\s*post\b/i },
  {
    kind: 'padmount_transformer',
    pattern: /\b(?:xfmrs?|transformers?|trans)\b[^|]*\bpad[\s-]?(?:mount(?:ed)?|mt)?\b|\bpad[\s-]?(?:mount(?:ed)?|mt)\b[^|]*\b(?:xfmrs?|transformers?|trans)\b/i,
  },
  {
    kind: 'overhead_transformer',
    pattern: /\b(?:xfmrs?|transformers?|trans)\b[^|]*\b(?:pole[\s-]?(?:mount(?:ed)?|type)?|OH|overhead)\b|\b(?:pole[\s-]?(?:mount(?:ed)?|type)|OH|overhead)\b[^|]*\b(?:xfmrs?|transformers?|trans)\b/i,
  },
  { kind: 'bare_conductor', pattern: /\bACSR\b|\bAAC\b|\bbare\b|\blinnet\b|\bpenguin\b|\boriole\b/i },
  { kind: 'primary_cable', pattern: /\bcable\b|\bURD\b|\bEPR\b|\bTRXLPE\b/i },
];

export function detectKind(text: string): Hit | null {
  for (const { kind, pattern } of KIND_PATTERNS) {
    const m = firstMatch(text, pattern);
    if (m) return { value: kind, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

function toVolts(raw: string, unit: string | undefined): number {
  const n = Number(raw);
  return unit && /kv/i.test(unit) ? Math.round(n * 1000) : n;
}

const PAIR = /(\d+(?:\.\d+)?)\s*(kV|V)?\s*(GrdY|GY|Y)?\s*\/\s*(\d+(?:\.\d+)?)\s*(kV|V)?(\s*Y)?/gi;

/** Transformer primary and secondary voltages, canonicalized. */
function voltages(text: string, kind: EquipmentKind): { primary?: Hit; secondary?: Hit } {
  const out: { primary?: Hit; secondary?: Hit } = {};
  for (const m of allMatches(text, PAIR)) {
    const a = toVolts(m[1]!, m[2] ?? m[5]);
    const b = toVolts(m[4]!, m[5] ?? m[2]);
    const wye = Boolean(m[3] || m[6]);
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    const start = m.index;
    const end = m.index + m[0].length;
    if (hi >= 2400) {
      // Distribution primary, written high/low with a grounded-wye marker.
      out.primary ??= { value: `${hi}GrdY/${lo}`, start, end };
    } else if (hi === 240 && lo === 120 && !wye) {
      out.secondary ??= { value: '120/240', start, end };
    } else if (hi <= 600) {
      out.secondary ??= { value: `${hi}Y/${lo}`, start, end };
    }
  }
  if (!out.primary && kind !== 'padmount_switchgear') {
    // Single-phase primaries are written as one voltage: "7200V", "7.2 kV PRI".
    const single = firstMatch(text, /\b(\d{4,5})\s*V\b|\b(\d{1,2}(?:\.\d+)?)\s*kV\s*(?:PRI|primary)\b|\bPRI(?:MARY)?\s*(\d{4,5})\b/i);
    if (single) {
      const volts = single[1] ? Number(single[1]) : single[2] ? Math.round(Number(single[2]) * 1000) : Number(single[3]);
      out.primary = { value: String(volts), start: single.index, end: single.index + single[0].length };
    }
  }
  return out;
}

function numberHit(text: string, pattern: RegExp, scale = 1, group = 1): Hit | null {
  const m = firstMatch(text, pattern);
  if (!m || m[group] === undefined) return null;
  return { value: Math.round(Number(m[group].replace(/,/g, '')) * scale * 1000) / 1000, start: m.index, end: m.index + m[0].length };
}

function enumHit(text: string, table: { pattern: RegExp; value: AttributeValue }[]): Hit | null {
  for (const { pattern, value } of table) {
    const m = firstMatch(text, pattern);
    if (m) return { value, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

const CONDUCTOR_CODEWORDS: Record<string, { size: string; stranding: string }> = {
  LINNET: { size: '336.4', stranding: '26/7' },
  ORIOLE: { size: '336.4', stranding: '30/7' },
  MERLIN: { size: '336.4', stranding: '18/1' },
  PENGUIN: { size: '4/0', stranding: '6/1' },
  RAVEN: { size: '1/0', stranding: '6/1' },
};

function conductorSize(text: string): Hit | null {
  const awg = firstMatch(text, /#?\b([1-4]\/0)\b(?:\s*AWG)?/i);
  if (awg) return { value: awg[1]!, start: awg.index, end: awg.index + awg[0].length };
  const kcmil = firstMatch(text, /\b(\d{2,4}(?:\.\d)?)\s*(?:kcmil|MCM)\b/i);
  if (kcmil) return { value: kcmil[1]!, start: kcmil.index, end: kcmil.index + kcmil[0].length };
  return null;
}

const KV_CLASS = /\b(\d{1,2}(?:\.\d)?)\s*kV\b(?!\s*(?:MCOV|PRI\b|primary(?!\s+cable)|GrdY|GY|Y\b))/i;

/**
 * Extract every attribute this module can read from a line description.
 * Returns an empty list when the equipment kind can't be identified, because
 * attributes are only meaningful relative to a kind.
 */
export function extractAttributes(text: string): ExtractedAttribute[] {
  const kindHit = detectKind(text);
  if (!kindHit) return [];
  const kind = kindHit.value as EquipmentKind;
  const hits = new Map<AttributeName, Hit>();
  hits.set('kind', kindHit);

  const set = (name: AttributeName, hit: Hit | null | undefined) => {
    if (hit) hits.set(name, hit);
  };

  const phases = enumHit(text, [
    { pattern: /\b(?:3|three)[\s-]*(?:ph(?:ase)?|Ø)\b|\b3Ø/i, value: 3 },
    { pattern: /\b(?:1|single)[\s-]*(?:ph(?:ase)?|Ø)\b|\b1Ø/i, value: 1 },
  ]);

  switch (kind) {
    case 'padmount_transformer':
    case 'overhead_transformer': {
      set('phases', phases);
      set('kva', numberHit(text, /\b(\d+(?:\.\d+)?)\s*kVA\b/i) ?? numberHit(text, /\b(\d+(?:\.\d+)?)\s*MVA\b/i, 1000));
      const v = voltages(text, kind);
      set('primaryVoltage', v.primary);
      set('secondaryVoltage', v.secondary);
      set(
        'fluid',
        enumHit(text, [
          { pattern: /\bFR-?3\b|\bnatural\s+ester\b|\bvegetable\s+oil\b|\bester\s+fluid\b/i, value: 'natural_ester' },
          { pattern: /\bmin(?:eral)?\.?\s+oil\b|\bmineral\b/i, value: 'mineral_oil' },
        ]),
      );
      set(
        'efficiencyStandard',
        enumHit(text, [{ pattern: /\bDOE[\s-]*(?:20)?16\b|\b10\s*CFR\s*(?:Part\s*)?431\b/i, value: 'DOE-2016' }]),
      );
      set(
        'feed',
        enumHit(text, [
          { pattern: /\bloop(?:[\s-]*feed)?\b/i, value: 'loop' },
          { pattern: /\bradial(?:[\s-]*feed)?\b/i, value: 'radial' },
        ]),
      );
      break;
    }
    case 'fuse_cutout':
      set('voltageClassKv', numberHit(text, KV_CLASS));
      set('amps', numberHit(text, /\b(\d{2,4})\s*A(?:mps?)?\b/i));
      break;
    case 'surge_arrester':
      set('mcovKv', numberHit(text, /\b(\d{1,2}(?:\.\d+)?)\s*kV\s*MCOV\b|\bMCOV\s*:?\s*(\d{1,2}(?:\.\d+)?)/i) ?? numberHit(text, /\bMCOV\s*:?\s*(\d{1,2}(?:\.\d+)?)/i));
      break;
    case 'primary_cable':
      set('voltageClassKv', numberHit(text, KV_CLASS));
      set('conductorSize', conductorSize(text));
      set(
        'conductorMaterial',
        enumHit(text, [
          { pattern: /\bAL(?:UM(?:INUM)?)?\b/i, value: 'AL' },
          { pattern: /\bCU\b|\bcopper\b/i, value: 'CU' },
        ]),
      );
      set('insulationLevel', numberHit(text, /\b(100|133|173)\s*%/));
      break;
    case 'bare_conductor': {
      const code = firstMatch(text, /\b(LINNET|ORIOLE|MERLIN|PENGUIN|RAVEN)\b/i);
      if (code) {
        const spec = CONDUCTOR_CODEWORDS[code[1]!.toUpperCase()]!;
        const at = { start: code.index, end: code.index + code[0].length };
        hits.set('conductorSize', { value: spec.size, ...at });
        hits.set('stranding', { value: spec.stranding, ...at });
      }
      set('conductorSize', hits.get('conductorSize') ?? conductorSize(text));
      // Stranding is written n/m with m ≥ 1; "4/0" is a wire size, not a stranding.
      const strand = allMatches(text, /\b(\d{1,2}\/[1-9])\b/i)[0];
      if (strand) {
        hits.set('stranding', { value: strand[1]!, start: strand.index, end: strand.index + strand[0].length });
      }
      set(
        'conductorMaterial',
        enumHit(text, [
          { pattern: /\bACSR\b/i, value: 'ACSR' },
          { pattern: /\bAAC\b/i, value: 'AAC' },
        ]),
      );
      break;
    }
    case 'post_insulator':
      set('voltageClassKv', numberHit(text, KV_CLASS));
      break;
    case 'recloser':
      set('phases', phases);
      set('voltageClassKv', numberHit(text, KV_CLASS));
      set('amps', numberHit(text, /\b(\d{2,4})\s*A(?:mps?)?\b/i));
      break;
    case 'meter':
      set('meterForm', enumHit(text, [{ pattern: /\b(?:form|FM)\s*-?\s*2S\b|\b2S\b/i, value: '2S' }]));
      set('meterClass', numberHit(text, /\b(?:CL|class)\s*-?\s*(\d{2,3})\b/i));
      break;
    case 'padmount_switchgear':
      set('voltageClassKv', numberHit(text, KV_CLASS));
      set('amps', numberHit(text, /\b(\d{2,4})\s*A(?:mps?)?\b/i));
      set('ways', numberHit(text, /\b(\d)[\s-]*way\b/i));
      break;
    case 'loadbreak_elbow':
      set('voltageClassKv', numberHit(text, KV_CLASS));
      set('amps', numberHit(text, /\b(\d{2,4})\s*A(?:mps?)?\b/i));
      set('conductorSize', conductorSize(text));
      break;
  }

  return [...hits.entries()].map(([name, hit]) => ({
    name,
    value: hit.value,
    evidence: span(text, hit.start, hit.end),
  }));
}
