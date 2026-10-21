import { Bookmark, BookmarkCheck, FolderPlus, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { tween } from "../motion";

type Props = {
  /** Keep the search itself, rerun each time it opens. */
  live?: { saved: boolean; onToggle: () => void; hint: string };
  /** Keep the assets on screen as a fixed collection. */
  keep?: { count: number; onKeep: () => void };
  disabled?: boolean;
};

export function SaveMenu({ live, keep, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  if (!live && !keep) return null;
  const saved = !!live?.saved;
  const pick = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`pressable inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] ring-1 ring-[var(--hairline-strong)] disabled:opacity-40 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.06] ${saved ? "text-[var(--accent)]" : "text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"}`}
      >
        {saved ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}
        {saved ? "Saved" : "Save"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Save"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, transition: tween.morphOut }}
            transition={tween.morph}
            style={{ transformOrigin: "top right" }}
            className="absolute top-full right-0 z-30 mt-1.5 w-64 rounded-[14px] bg-[var(--surface)] p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.25)] ring-1 ring-[var(--hairline)]"
          >
            {live && (
              <Item
                icon={saved ? BookmarkCheck : RefreshCw}
                label={saved ? "Stop keeping it live" : "Keep it live"}
                hint={saved ? "Removes it from Saved" : live.hint}
                onClick={() => pick(live.onToggle)}
              />
            )}
            {keep && (
              <Item
                icon={FolderPlus}
                label={`Keep these ${keep.count}`}
                hint="A collection that stays as it is"
                onClick={() => pick(keep.onKeep)}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Item({ icon: Icon, label, hint, onClick }: { icon: typeof Bookmark; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.05] focus-visible:bg-[var(--ink)]/[0.05] focus-visible:outline-none"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--text)]">{label}</span>
        <span className="block text-[12px] text-[var(--text-tertiary)]">{hint}</span>
      </span>
    </button>
  );
}
