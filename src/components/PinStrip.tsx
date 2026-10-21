import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Columns2, Download, FolderPlus, Pin, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { type Asset, api, thumb } from "../api";
import { tween } from "../motion";
import { Pressable } from "./Pressable";
import { TextMorph } from "./TextMorph";

type Props = {
  assets: Asset[];
  openId: string | null;
  onOpen: (a: Asset) => void;
  onUnpin: (a: Asset) => void;
  onCompare: () => void;
  onSave: (assets: Asset[]) => void;
  onClear: () => void;
};

const quiet =
  "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.05] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]";

/** Everything pinned this session, floating over the bottom of the canvas. It routes the pins to an import, a collection or a side-by-side compare. */
export function PinStrip({ assets, openId, onOpen, onUnpin, onCompare, onSave, onClear }: Props) {
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLButtonElement>(null);
  return (
    <motion.section
      aria-label="Pinned assets"
      initial={{ opacity: 0, transform: "translateY(8px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: "translateY(8px)", transition: tween.trayExit }}
      transition={tween.trayEnter}
      className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-[16px] bg-[var(--surface)] py-1.5 pr-1.5 pl-3 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.18)] ring-1 ring-[var(--hairline-strong)]"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-[var(--text)]">
        <Pin className="size-3.5 text-[var(--text-tertiary)]" aria-hidden />
        <span className="hidden sm:inline">Pinned</span>
        <span className="font-normal text-[var(--text-tertiary)] tabular-nums">{assets.length}</span>
      </span>
      <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]">
        <AnimatePresence initial={false}>
          {assets.map((a) => (
            <motion.li
              key={a.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: tween.trayExit }}
              transition={tween.trayEnter}
              className="group/pin relative shrink-0"
            >
              <button
                type="button"
                onClick={() => onOpen(a)}
                aria-label={`Open ${a.name}`}
                aria-current={a.id === openId ? "true" : undefined}
                title={a.name}
                className={`block size-10 overflow-hidden rounded-[9px] bg-[var(--raised)] ring-1 ${a.id === openId ? "ring-2 ring-[var(--text)]" : "ring-[var(--hairline)] [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[var(--text-tertiary)]"}`}
              >
                <img src={thumb(a.id)} alt="" className="h-full w-full object-contain p-0.5" />
              </button>
              <button
                type="button"
                onClick={() => onUnpin(a)}
                aria-label={`Unpin ${a.name}`}
                className="absolute -top-1 -right-1 hidden size-4 items-center justify-center rounded-full bg-[var(--text)] text-[var(--surface)] group-hover/pin:flex group-focus-within/pin:flex"
              >
                <X className="size-2.5" aria-hidden />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <span className="flex shrink-0 items-center gap-0.5">
        <Pressable onClick={onCompare} aria-label="Compare side by side" title="Compare side by side, to scale" className={quiet}>
          <Columns2 className="size-3.5" aria-hidden />
          <span className="hidden md:inline">Compare</span>
        </Pressable>
        <Pressable onClick={() => onSave(assets)} aria-label="Save as collection" title="Save as collection" className={quiet}>
          <FolderPlus className="size-3.5" aria-hidden />
          <span className="hidden md:inline">Save</span>
        </Pressable>
        <Pressable onClick={onClear} aria-label="Clear pins" title="Clear pins" className={`${quiet} text-[var(--text-tertiary)]`}>
          <X className="size-3.5" aria-hidden />
        </Pressable>
        <Pressable
          ref={importRef as never}
          onClick={() => setImporting(true)}
          className="ml-1 h-8 rounded-full bg-[var(--accent)] px-3.5 text-[12.5px] font-semibold text-[var(--on-accent)]"
        >
          Import
        </Pressable>
      </span>
      <ImportDialog open={importing} assets={assets} anchor={importRef} onClose={() => setImporting(false)} />
    </motion.section>
  );
}

function ImportDialog({ open, assets, anchor, onClose }: { open: boolean; assets: Asset[]; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const [phase, setPhase] = useState<"idle" | "importing" | "done">("idle");
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return setPhase("idle");
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const box = anchor.current?.getBoundingClientRect();
  const label = phase === "importing" ? "Importing…" : phase === "done" ? "Imported" : `Import ${assets.length} ${assets.length === 1 ? "asset" : "assets"}`;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close import"
            className="fixed inset-0 z-40 bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tween.fade}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Import assets"
            className="fixed z-50 w-[min(420px,calc(100vw-2rem))] rounded-[16px] bg-[var(--surface)] p-4 shadow-[0_24px_80px_rgb(0_0_0/0.12),0_8px_24px_rgb(0_0_0/0.35)] ring-1 ring-[var(--hairline-strong)]"
            style={{
              right: Math.max(16, window.innerWidth - (box?.right ?? window.innerWidth)),
              bottom: window.innerHeight - (box?.top ?? window.innerHeight) + 8,
              transformOrigin: "bottom right",
            }}
            initial={{ opacity: 0, transform: reduce ? "none" : "translateY(8px) scale(0.96)" }}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={{ opacity: 0, transform: reduce ? "none" : "translateY(4px) scale(0.96)", transition: tween.trayExit }}
            transition={reduce ? tween.fade : tween.trayEnter}
          >
            <div className="mb-3 flex items-center gap-2">
              <Download className="size-5 text-[var(--accent)]" aria-hidden />
              <h2 className="text-[15px] font-semibold text-[var(--text)]">Import into your scene</h2>
            </div>
            <div className="mb-4 max-h-40 space-y-1 overflow-y-auto">
              {assets.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                  <img src={thumb(a.id)} alt="" className="h-8 w-8 rounded bg-[var(--raised)] object-contain" />
                  {a.name}
                </div>
              ))}
            </div>
            <Pressable
              onClick={() => {
                setPhase("importing");
                window.setTimeout(() => setPhase("done"), 900);
              }}
              disabled={phase !== "idle"}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] py-2.5 text-[13px] font-semibold text-[var(--on-accent)] disabled:opacity-70"
            >
              <TextMorph text={label} />
            </Pressable>
            <p className="mt-2 text-center text-[11px] text-[var(--text-tertiary)]">Prototype only. Nothing is sent to a scene.</p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Library assets that go with what's pinned, for the home page. */
export function usePinComplements(items: Asset[]) {
  const [suggested, setSuggested] = useState<Asset[]>([]);
  const ids = items.map((i) => i.id).join(",");

  useEffect(() => {
    if (!ids) return setSuggested([]);
    let live = true;
    api
      .complements(ids.split(","), 6)
      .then((r) => live && setSuggested(r.results))
      .catch(() => live && setSuggested([]));
    return () => {
      live = false;
    };
  }, [ids]);

  return suggested;
}
