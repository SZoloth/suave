import { type Asset, thumb } from "../api";
import { formatMetres, size } from "../parse";

type Props = {
  asset: Asset;
  inCart: boolean;
  onToggleCart: (a: Asset) => void;
  onOpen: (a: Asset) => void;
  /** Replaces the default height line, e.g. with the value the results are sorted by. */
  caption?: string | null;
  /** What the asset gives for the search, e.g. "3 to pick from", shown as a tag under the caption. */
  note?: string | null;
};

export function AssetCard({ asset, inCart, onToggleCart, onOpen, caption, note }: Props) {
  const dims = size(asset);
  const heightLabel = caption ?? (dims ? `${formatMetres(dims.h)} tall` : null);
  const detail = heightLabel ?? (asset.categories.slice(0, 2).join(" · ") || "uncategorised");

  return (
    <div className="group relative flex flex-col self-start">
      <button
        type="button"
        onClick={() => onOpen(asset)}
        className="relative block aspect-square w-full overflow-hidden rounded-[12px] bg-[var(--raised)] ring-1 ring-[var(--hairline)] transition-[box-shadow,ring-color] duration-150 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[var(--hairline-strong)]"
        aria-label={`Open ${asset.name}`}
        style={{
          backgroundImage: "radial-gradient(ellipse 80% 70% at 50% 45%, rgb(255 255 255 / 0.06), transparent 70%)",
        }}
      >
        <img src={thumb(asset.id)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain p-2" />
      </button>
      {asset.visibility === "HIDE" && (
        <span
          className="pointer-events-none absolute top-2 left-2 rounded-full bg-[var(--surface)]/90 px-1.5 py-px text-[11px] text-[var(--text-secondary)] shadow-[0_1px_2px_rgb(0_0_0/0.08)] backdrop-blur"
          title="Hidden in Library"
        >
          Hidden
        </span>
      )}
      <button
        type="button"
        onClick={() => onToggleCart(asset)}
        aria-pressed={inCart}
        aria-label={inCart ? `Unpin ${asset.name}` : `Pin ${asset.name}`}
        className={`pressable absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-[11px] font-medium backdrop-blur ${
          inCart
            ? "bg-[var(--accent)]/25 text-[var(--accent)]"
            : "bg-[var(--surface)]/85 text-[var(--text)] opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
        }`}
      >
        {inCart ? "Pinned" : "Pin"}
      </button>
      <div className="px-1 pt-2">
        <div className="truncate text-[13px] font-medium text-[var(--text)]" title={asset.name}>
          {asset.name}
        </div>
        <div className="truncate text-[12px] text-[var(--text-tertiary)]">{detail}</div>
        {note && (
          <div className="mt-1 inline-flex rounded-md bg-[var(--raised)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]">
            {note}
          </div>
        )}
      </div>
    </div>
  );
}
