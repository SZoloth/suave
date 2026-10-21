import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { equalShares as equal, resize } from "../lib/split";

const MIN_PANE = 280;
const STEP = 0.04;

type Props = { panes: { key: string; label: string; node: ReactNode }[] };

/** Searches side by side at equal widths; drag a divider to resize, double-click it to even them out. */
export function SplitPanes({ panes }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(() => ({ keys: panes.map((p) => p.key).join(), shares: equal(panes.length) }));
  const keys = panes.map((p) => p.key).join();
  const shares = state.keys === keys ? state.shares : equal(panes.length);
  const set = (next: number[]) => setState({ keys, shares: next });
  const minShare = () => Math.min(MIN_PANE / (row.current?.clientWidth || 1), 1 / panes.length);

  const drag = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    const width = row.current?.clientWidth;
    if (!width) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, shares };
    const move = (ev: globalThis.PointerEvent) => set(resize(start.shares, i, (ev.clientX - start.x) / width, minShare()));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  return (
    <div ref={row} className="flex h-full min-w-0">
      {panes.map((p, i) => (
        <div key={p.key} className="contents">
          {i > 0 && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${panes[i - 1].label} and ${p.label}`}
              aria-valuenow={Math.round(shares[i - 1] * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              tabIndex={0}
              onPointerDown={drag(i - 1)}
              onDoubleClick={() => set(equal(panes.length))}
              onKeyDown={(e) => {
                const d = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0;
                if (!d) return;
                e.preventDefault();
                set(resize(shares, i - 1, d, minShare()));
              }}
              title="Drag to resize, double-click to even out"
              className="group/sep flex w-3 shrink-0 cursor-col-resize touch-none justify-center self-stretch outline-none"
            >
              <span className="w-px bg-[var(--hairline)] transition-colors duration-150 group-hover/sep:w-[2px] group-hover/sep:bg-[var(--accent)] group-focus-visible/sep:w-[2px] group-focus-visible/sep:bg-[var(--accent)]" />
            </div>
          )}
          <div className="h-full min-w-0" style={{ flex: `${shares[i]} 1 0px` }}>
            {p.node}
          </div>
        </div>
      ))}
    </div>
  );
}
