import type { Asset } from "./api.ts";
import { facetLabel } from "./facets.ts";
import { MAX_PARTS } from "./compose/program.ts";
import { size } from "./parse.ts";

type DataField = { label: string; kind: "data"; value: (a: Asset) => string | null };
type JudgedField = { label: string; kind: "judged" };
type FieldDef = DataField | JudgedField;

export const FIELDS = {
  author: {
    label: "Author",
    kind: "data",
    value: (a) => {
      const raw = a.author?.trim();
      if (!raw) return null;
      const first = raw.split(",")[0]?.trim();
      return first || null;
    },
  },
  show: {
    label: "Show",
    kind: "data",
    value: (a) => (a.show ? facetLabel("show", a.show as "nightshift") : null),
  },
  status: {
    label: "Status",
    kind: "data",
    value: (a) => (a.approvalStatus ? facetLabel("approvalStatus", a.approvalStatus as "approved") : null),
  },
  type: {
    label: "Asset Type",
    kind: "data",
    value: (a) => (a.assetType ? facetLabel("assetType", a.assetType as "geometry") : null),
  },
  modified: {
    label: "Last Modified",
    kind: "data",
    value: (a) => monthLabel(a.lastModifiedAt),
  },
  created: {
    label: "Created",
    kind: "data",
    value: (a) => monthLabel(a.createdAt),
  },
  collection: {
    label: "Collection",
    kind: "data",
    value: (a) => a.collections[0] ?? null,
  },
  size: {
    label: "Size",
    kind: "data",
    value: (a) => sizeBucket(a),
  },
  era: { label: "Era", kind: "judged" },
  color: { label: "Color", kind: "judged" },
  material: { label: "Material", kind: "judged" },
  style: { label: "Style", kind: "judged" },
} as const satisfies Record<string, FieldDef>;

export type FieldKey = keyof typeof FIELDS;

export const GROUP_KEYS = Object.keys(FIELDS) as FieldKey[];

export type DataFieldKey = "author" | "show" | "status" | "type" | "modified" | "created" | "collection" | "size";

export const CARD_KEYS: DataFieldKey[] = ["author", "show", "status", "type", "modified", "created", "collection", "size"];

/** Short examples for Jev's group-by choice. */
export const GROUP_BY_HINTS: Record<FieldKey, string> = {
  author: "'by who made them', 'grouped by artist'",
  show: "'by show', 'grouped by production'",
  status: "'by approval status', 'grouped by status'",
  type: "'by asset type', 'grouped by type'",
  modified: "'by when they were changed', 'grouped by last modified'",
  created: "'by when they were added', 'grouped by created date'",
  collection: "'by collection', 'grouped by collection'",
  size: "'by size', 'grouped by how tall they are'",
  era: "'one row per era', 'by period'",
  color: "'grouped by color', 'by colour'",
  material: "'grouped by material', 'by wood or metal'",
  style: "'grouped by style', 'by look'",
};

function monthLabel(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function sizeBucket(a: Asset): string | null {
  const h = size(a)?.h;
  if (h == null || h <= 0) return null;
  if (h < 0.3) return "Under 30 cm";
  if (h <= 1) return "30 cm to 1 m";
  return "Over 1 m";
}

/** Groups assets by a catalog field; biggest groups first, missing values last, at most five parts with an Other tail. */
export function groupAssets(assets: Asset[], key: DataFieldKey): { title: string; assets: Asset[] }[] {
  const field = FIELDS[key];
  const value = (field as DataField).value;
  const buckets = new Map<string | null, Asset[]>();
  for (const a of assets) {
    const v = value(a);
    const list = buckets.get(v);
    if (list) list.push(a);
    else buckets.set(v, [a]);
  }
  const parts = [...buckets.entries()].map(([v, group]) => ({
    title: v ?? `No ${field.label.toLowerCase()}`,
    assets: group,
    isNull: v == null,
    count: group.length,
  }));
  parts.sort((a, b) => (a.isNull !== b.isNull ? (a.isNull ? 1 : -1) : b.count - a.count));
  if (parts.length <= MAX_PARTS) return parts.map(({ title, assets: group }) => ({ title, assets: group }));
  const kept = parts.slice(0, MAX_PARTS - 1);
  const rest = parts.slice(MAX_PARTS - 1).flatMap((p) => p.assets);
  return [...kept.map(({ title, assets: group }) => ({ title, assets: group })), { title: "Other", assets: rest }];
}
