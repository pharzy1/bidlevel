/** Kinds of distribution equipment the leveler understands. */
export type EquipmentKind =
  | 'padmount_transformer'
  | 'overhead_transformer'
  | 'fuse_cutout'
  | 'surge_arrester'
  | 'primary_cable'
  | 'bare_conductor'
  | 'post_insulator'
  | 'recloser'
  | 'meter'
  | 'padmount_switchgear'
  | 'loadbreak_elbow';

/** Attribute names a requirement or an offer can carry. */
export type AttributeName =
  | 'kind'
  | 'phases'
  | 'kva'
  | 'primaryVoltage'
  | 'secondaryVoltage'
  | 'fluid'
  | 'efficiencyStandard'
  | 'voltageClassKv'
  | 'amps'
  | 'mcovKv'
  | 'conductorSize'
  | 'conductorMaterial'
  | 'insulationLevel'
  | 'stranding'
  | 'meterForm'
  | 'meterClass'
  | 'ways'
  | 'feed';

export type AttributeValue = string | number;

/** Where a fact came from: a character range inside one cell of one source row. */
export interface Evidence {
  /** Exact text of the span, copied from the source. */
  quote: string;
  start: number;
  end: number;
}

export interface ExtractedAttribute {
  name: AttributeName;
  value: AttributeValue;
  evidence: Evidence;
}

export type Uom = 'EA' | 'FT';

/** One line of the buyer's solicitation. */
export interface CatalogItem {
  id: string;
  line: number;
  description: string;
  quantity: number;
  uom: Uom;
  required: Partial<Record<AttributeName, AttributeValue>>;
}

/** One row of a vendor's price sheet, as submitted. */
export interface BidLine {
  vendor: string;
  /** 1-based row number in the vendor's file, header excluded. */
  row: number;
  /** Buyer line number the vendor referenced, when they gave one. */
  buyerLineRef: number | null;
  description: string;
  quantity: number | null;
  uomText: string;
  unitPriceText: string;
  leadTimeText: string;
  noBid: boolean;
}

export type AttributeStatus = 'meets' | 'deviates' | 'not_stated';

export interface AttributeCheck {
  name: AttributeName;
  required: AttributeValue;
  offered: AttributeValue | null;
  status: AttributeStatus;
  evidence: Evidence | null;
}

export interface NormalizedPrice {
  /** Price per catalog unit of measure, in dollars. */
  unitPrice: number;
  /** Plain-language account of the conversion, e.g. "$1,850.00 per 1,000 ft → $1.85 per ft". */
  explanation: string;
}

export type MatchSource = 'deterministic' | 'llm' | 'reviewer' | 'memory';

export type FlagCode =
  | 'deviation'
  | 'not_stated'
  | 'quantity_mismatch'
  | 'line_reference_conflict'
  | 'price_unreadable'
  | 'lead_time_unreadable'
  | 'ambiguous_match';

export interface Flag {
  code: FlagCode;
  message: string;
}

/** A vendor's offer for one catalog item, after matching and normalization. */
export interface LeveledCell {
  itemId: string;
  vendor: string;
  bid: BidLine;
  source: MatchSource;
  score: number;
  checks: AttributeCheck[];
  price: NormalizedPrice | null;
  extendedPrice: number | null;
  leadTimeWeeks: number | null;
  flags: Flag[];
  /** True when every required attribute is met and the price is readable. */
  compliant: boolean;
  /** Why a non-deterministic match was made, e.g. which past decision it came from. */
  note?: string;
}

/** A bid line the matcher could not place with confidence. */
export interface UnresolvedLine {
  bid: BidLine;
  attributes: ExtractedAttribute[];
  /** Best candidates, highest score first. */
  candidates: { itemId: string; score: number }[];
  reason: string;
}

export interface LevelingResult {
  catalog: CatalogItem[];
  vendors: string[];
  /** cells[itemId][vendor] */
  cells: Record<string, Record<string, LeveledCell | undefined>>;
  unresolved: UnresolvedLine[];
  noBids: BidLine[];
}
