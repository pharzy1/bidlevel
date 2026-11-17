import { z } from 'zod';
import { ATTRIBUTE_LABELS } from '../core/level.ts';
import type { CatalogItem, UnresolvedLine } from '../core/types.ts';

/**
 * What the model returns for one unresolved bid line. The model may only pick
 * from the candidates it was shown, or decline with null.
 */
export const SuggestionSchema = z.object({
  itemId: z.string().nullable(),
  evidence: z
    .array(
      z.object({
        claim: z.string(),
        /** Copied character for character from the vendor's description. */
        quote: z.string(),
      }),
    ),
  rationale: z.string(),
});

export type RawSuggestion = z.infer<typeof SuggestionSchema>;

/** Wire format between the browser and the resolve endpoint. */
export const ResolveRequestSchema = z.object({
  line: z.object({
    vendor: z.string(),
    row: z.number().int().positive(),
    description: z.string().max(2000),
    reason: z.string().max(500),
  }),
  candidates: z
    .array(
      z.object({
        id: z.string(),
        line: z.number(),
        description: z.string().max(2000),
        required: z.record(z.string(), z.union([z.string(), z.number()])),
      }),
    )
    .min(1)
    .max(5),
});

export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

export type Suggestion =
  | { status: 'suggested'; itemId: string; evidence: { claim: string; quote: string; start: number; end: number }[]; rationale: string }
  | { status: 'declined'; rationale: string }
  | { status: 'rejected'; problems: string[] };

/**
 * Accept a model answer only if it is grounded: the chosen line must be one of
 * the candidates, and every quote must appear verbatim in the vendor's text.
 * Anything else is rejected and the line stays with the reviewer.
 */
export function validateSuggestion(raw: unknown, request: ResolveRequest): Suggestion {
  const parsed = SuggestionSchema.safeParse(raw);
  if (!parsed.success) return { status: 'rejected', problems: ['The model returned an answer in the wrong shape.'] };
  const s = parsed.data;
  if (s.itemId === null) return { status: 'declined', rationale: s.rationale };

  const problems: string[] = [];
  if (!request.candidates.some((c) => c.id === s.itemId)) {
    problems.push(`It picked ${s.itemId}, which wasn't one of the candidates.`);
  }
  if (s.evidence.length === 0) problems.push('It gave no quoted evidence.');
  const text = request.line.description;
  const evidence = s.evidence.map((e) => {
    const start = e.quote.trim() === '' ? -1 : text.indexOf(e.quote);
    if (start === -1) problems.push(`"${e.quote}" doesn't appear in the vendor's description.`);
    return { ...e, start, end: start + e.quote.length };
  });
  if (problems.length > 0) return { status: 'rejected', problems };
  return { status: 'suggested', itemId: s.itemId, evidence, rationale: s.rationale };
}

export function buildResolveRequest(line: UnresolvedLine, catalog: CatalogItem[]): ResolveRequest {
  const ids = line.candidates.length > 0 ? line.candidates.map((c) => c.itemId) : catalog.map((i) => i.id);
  const kind = line.attributes.find((a) => a.name === 'kind')?.value;
  const candidates = catalog
    .filter((i) => ids.includes(i.id) && (kind === undefined || i.required.kind === kind))
    .slice(0, 5)
    .map((i) => ({ id: i.id, line: i.line, description: i.description, required: i.required as Record<string, string | number> }));
  return {
    line: { vendor: line.bid.vendor, row: line.bid.row, description: line.bid.description, reason: line.reason },
    candidates: candidates.length > 0 ? candidates : catalog.slice(0, 5).map((i) => ({ id: i.id, line: i.line, description: i.description, required: i.required as Record<string, string | number> })),
  };
}

export const SYSTEM_PROMPT = `You help a utility procurement team match lines in a supplier's price sheet to the lines of their request for proposal.

You get one supplier line that an automatic matcher could not place, the reason it couldn't, and up to five candidate RFP lines with their required specifications.

Pick the candidate the supplier line is offering, or return null for itemId if the text doesn't support a confident choice. Returning null is the right answer whenever you'd be guessing: a wrong match puts a supplier's price against the wrong equipment, which is worse than leaving the line for a person.

Support your choice with evidence. Each evidence item states a claim and quotes the exact characters from the supplier's description that support it, copied character for character, including case and punctuation. Quote only the supplier's description, never the candidates. Part numbers, model codes and unit sizes embedded in codes count as evidence when they plainly encode a rating, for example a code containing "150" next to a transformer type.

Keep the rationale to two sentences. Don't restate the evidence.`;

export function userPrompt(req: ResolveRequest): string {
  const candidates = req.candidates
    .map((c) => {
      const specs = Object.entries(c.required)
        .filter(([k]) => k !== 'kind')
        .map(([k, v]) => `${ATTRIBUTE_LABELS[k as keyof typeof ATTRIBUTE_LABELS] ?? k}: ${v}`)
        .join('; ');
      return `<candidate id="${c.id}" rfp_line="${c.line}">\n${c.description}\nRequired: ${specs}\n</candidate>`;
    })
    .join('\n');
  return `<supplier_line vendor="${req.line.vendor}" row="${req.line.row}">\n${req.line.description}\n</supplier_line>\n<why_unmatched>${req.line.reason}</why_unmatched>\n<candidates>\n${candidates}\n</candidates>`;
}
