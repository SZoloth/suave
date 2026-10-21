/**
 * Library fields an artist can filter on. Keys are Library field names, so a facet value
 * travels unchanged from typed words to the retrieval filter to the asset record.
 * The stand-in library has sample values for all of them (see embed/sample_fields.py).
 */
export const FACETS = {
  show: {
    label: "Show",
    all: "All Shows",
    values: { nightshift: "Night Shift", stonegarden: "Stone Garden", lanternbay: "Lantern Bay", mosshollow: "Moss Hollow" },
    words: { nightshift: /\bnight ?shift\b/, stonegarden: /\bstone ?garden\b/, lanternbay: /\blantern ?bay\b/, mosshollow: /\bmoss ?hollow\b/ },
  },
  approvalStatus: {
    label: "Status",
    all: "Any status",
    values: { approved: "Approved", in_review: "In review", wip: "Work in progress" },
    words: { approved: /\b(approved|signed off)\b/, in_review: /\b(in review|under review|pending review)\b/, wip: /\b(wip|work in progress|unapproved|not approved)\b/ },
  },
  assetType: {
    label: "Asset Type",
    all: "All Asset Types",
    values: { geometry: "Environment", location: "Environment Assembly" },
    words: { geometry: /\bgeometr(y|ies)\b/, location: /\b(environment )?assembl(y|ies)\b/ },
  },
  visibility: {
    label: "Visibility",
    all: "Not hidden",
    values: { HIDE: "Hidden" },
    words: { HIDE: /\bhidden\b/ },
  },
} as const;

export type FacetKey = keyof typeof FACETS;
export type FacetValue<K extends FacetKey> = keyof (typeof FACETS)[K]["values"] & string;
export type Facets = { [K in FacetKey]?: FacetValue<K> };

export const FACET_KEYS = Object.keys(FACETS) as FacetKey[];

export const facetLabel = <K extends FacetKey>(key: K, value: FacetValue<K>): string => (FACETS[key].values as Record<string, string>)[value];

/** Facets the words name outright: "approved chairs on Night Shift" → {approvalStatus: approved, show: nightshift}. "not approved" wins over "approved". */
export function readFacets(text: string): Facets {
  const t = text.toLowerCase();
  const out: Record<string, string> = {};
  for (const key of FACET_KEYS) {
    const hits = Object.entries(FACETS[key].words as Record<string, RegExp>).filter(([, re]) => re.test(t));
    if (hits.length > 0) out[key] = hits.sort(([, a], [, b]) => (t.match(b)?.[0].length ?? 0) - (t.match(a)?.[0].length ?? 0))[0][0];
  }
  return out as Facets;
}

/** The text without facet words, so "approved chairs on Night Shift" searches for "chairs". */
export function stripFacets(text: string): string {
  const any = FACET_KEYS.flatMap((key) => Object.values(FACETS[key].words as Record<string, RegExp>).map((re) => re.source)).join("|");
  return text
    .replace(new RegExp(String.raw`(\b(on|for|from|in)\s+)?(${any})`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}
