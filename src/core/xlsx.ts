/**
 * Read the first worksheet of an .xlsx workbook into rows of text, with no
 * dependencies: the zip container is parsed by hand and deflated parts are
 * inflated with the platform's DecompressionStream (browsers and Node 18+).
 *
 * Handles shared strings, inline strings, numbers, booleans and cached formula
 * results. Formulas without a cached value read as empty.
 */

export class XlsxError extends Error {}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

function u16(b: Uint8Array, at: number) {
  return b[at]! | (b[at + 1]! << 8);
}

function u32(b: Uint8Array, at: number) {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

function zipEntries(b: Uint8Array): Map<string, ZipEntry> {
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('This file is not an Excel workbook (.xlsx).');
  const count = u16(b, eocd + 10);
  let at = u32(b, eocd + 16);
  const out = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(b, at) !== 0x02014b50) throw new XlsxError('The workbook’s zip directory is damaged.');
    const method = u16(b, at + 10);
    const compressedSize = u32(b, at + 20);
    const nameLen = u16(b, at + 28);
    const extraLen = u16(b, at + 30);
    const commentLen = u16(b, at + 32);
    const offset = u32(b, at + 42);
    const name = decoder.decode(b.subarray(at + 46, at + 46 + nameLen));
    out.set(name, { name, method, compressedSize, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(b: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const e = entries.get(name);
  if (!e) return null;
  if (u32(b, e.offset) !== 0x04034b50) throw new XlsxError(`The workbook part ${name} is damaged.`);
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const raw = b.subarray(start, start + e.compressedSize);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
  if (!bytes) throw new XlsxError(`The workbook uses an unsupported compression method (${e.method}).`);
  return new TextDecoder().decode(bytes);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? _;
  });
}

/** All text of every <t> element in a fragment, joined (rich-text runs are split across several). */
function texts(fragment: string): string {
  return [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

/** The path of the first worksheet, following workbook.xml and its relationships. */
async function firstSheetPath(b: Uint8Array, entries: Map<string, ZipEntry>): Promise<string> {
  const workbook = await readEntry(b, entries, 'xl/workbook.xml');
  const rels = await readEntry(b, entries, 'xl/_rels/workbook.xml.rels');
  const sheet = workbook ? /<sheet\b[^>]*>/.exec(workbook)?.[0] : undefined;
  const rid = sheet ? attr(sheet, 'r:id') : undefined;
  if (rels && rid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], 'Id') === rid) {
        const target = attr(m[0], 'Target')!;
        return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      }
    }
  }
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  throw new XlsxError('The workbook has no worksheet.');
}

export async function readXlsxRows(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = zipEntries(b);
  const shared: string[] = [];
  const sst = await readEntry(b, entries, 'xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]!));
  const sheet = await readEntry(b, entries, await firstSheetPath(b, entries));
  if (!sheet) throw new XlsxError('The workbook’s first worksheet is missing.');

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rowNumber = Number(attr(rowMatch[1] ?? rowMatch[3] ?? '', 'r') ?? rows.length + 1);
    const row: string[] = [];
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = c[1]!;
      const body = c[2] ?? '';
      const ref = attr(head, 'r');
      const col = ref ? columnIndex(ref) : row.length;
      const type = attr(head, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = v !== undefined ? (shared[Number(v)] ?? '') : '';
      else if (type === 'inlineStr') value = texts(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else if (v !== undefined) value = decodeXml(v);
      while (row.length < col) row.push('');
      row[col] = value;
    }
    // Keep sheet row positions, so blank rows stay blank rather than collapsing.
    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = row;
  }
  return rows;
}
