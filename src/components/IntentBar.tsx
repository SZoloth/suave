import type { FacetKey, FacetValue } from "../facets";
import type { FieldKey } from "../fields";
import type { Count, Sort, Subject, Turn, View, Window } from "../intent";

/** Artist choices that beat Jev's reading. null means the artist removed a filter the words set. */
export type Overrides = {
  view?: View;
  count?: Count;
  subject?: Subject;
  exact?: boolean;
  sort?: Sort;
  window?: Window;
  author?: string | null;
  facets?: { [K in FacetKey]?: FacetValue<K> | null };
  turn?: Turn;
  groupBy?: FieldKey | null;
  show?: FieldKey[];
};
