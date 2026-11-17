import type { ReactNode } from 'react';

export interface Mark {
  start: number;
  end: number;
  label: string;
  tone: 'meets' | 'deviates' | 'neutral';
}

/** Render source text with the spans that support each finding marked in place. */
export function Highlight({ text, marks }: { text: string; marks: Mark[] }) {
  const sorted = [...marks].filter((m) => m.start >= 0 && m.end > m.start).sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of sorted) {
    if (m.start < at) continue; // overlapping spans: keep the first
    if (m.start > at) parts.push(text.slice(at, m.start));
    parts.push(
      <mark key={`${m.start}-${m.end}`} className={`ev ev-${m.tone}`} title={m.label}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <q className="source-text">{parts}</q>;
}
