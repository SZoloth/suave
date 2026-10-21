import { Check, FolderPlus, FolderInput } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { type Asset, api, thumb } from "../api";
import type { LocalCollection } from "../lib/collections";
import { tween } from "../motion";

export type TrayResult =
  | { kind: "created"; id: string; name: string; visible: boolean; assets: Asset[] }
  | { kind: "added"; id: string; name: string; assets: Asset[] };

type Props = {
  assets: Asset[];
  suggestedName: string;
  collections: LocalCollection[];
  /** The collection a typed line named ("put these in my barrels collection"). */
  targetId?: string | null;
  onCancel: () => void;
  onDone: (result: TrayResult) => void;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Nothing is written until Create or Add. Unticking drops a wrong member without leaving the tray. */
export function CollectionTray({ assets, suggestedName, collections, targetId: named, onCancel, onDone }: Props) {
  const [name, setName] = useState(suggestedName);
  const [targetId, setTargetId] = useState<string | null>(() => named ?? collections.find((c) => same(c.name, suggestedName))?.id ?? null);
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = collections.find((c) => c.id === targetId) ?? null;
  const already = new Set(target?.assets.map((a) => a.id));
  const kept = assets.filter((a) => !dropped.has(a.id) && !already.has(a.id));
  const ready = (target != null || name.trim().length > 0) && kept.length > 0 && !saving;

  const toggle = (id: string) =>
    setDropped((d) => {
      const next = new Set(d);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      if (target) {
        await api.addToCollection(target.libraryId, kept);
        onDone({ kind: "added", id: target.id, name: target.name, assets: kept });
      } else {
        const made = await api.createCollection(name.trim(), kept, visible);
        onDone({ kind: "created", id: made.id, name: made.name, visible, assets: kept });
      }
    } catch {
      setError(`Couldn't ${target ? "add to" : "create"} the collection. Is the Library service running?`);
      setSaving(false);
    }
  };

  const pill = (on: boolean) =>
    `pressable shrink-0 rounded-full px-2.5 py-1 text-[12.5px] ring-1 ${
      on
        ? "bg-[var(--ink)]/[0.08] font-medium text-[var(--text)] ring-[var(--hairline-strong)]"
        : "text-[var(--text-secondary)] ring-[var(--hairline)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
    }`;
  const Icon = target ? FolderInput : FolderPlus;

  return (
    <motion.section
      aria-label={target ? `Add to ${target.name}` : "New collection"}
      initial={{ opacity: 0, transform: "translateY(-6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: "translateY(-6px)" }}
      transition={tween.trayEnter}
      className="mt-4 overflow-hidden rounded-[16px] bg-[var(--surface)] shadow-[0_12px_40px_-12px_rgb(0_0_0/0.12)] ring-1 ring-[var(--hairline-strong)]"
    >
      <header className="flex items-center gap-3 border-b border-[var(--hairline)] py-3 pr-3 pl-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--raised)] ring-1 ring-[var(--hairline)]">
          <Icon className="size-4 text-[var(--text)]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {target ? (
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">{target.name}</p>
          ) : (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              aria-label="Collection name"
              placeholder="Name this collection"
              className="w-full bg-transparent text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          )}
          <p className="text-[12px] text-[var(--text-tertiary)] tabular-nums">
            {target
              ? `Add to existing · ${kept.length} new${already.size ? `, ${assets.filter((a) => already.has(a.id)).length} already in it` : ""}`
              : `New collection · ${kept.length} of ${assets.length} assets`}
          </p>
        </div>
      </header>

      {collections.length > 0 && (
        <div role="radiogroup" aria-label="Save to" className="flex gap-1.5 overflow-x-auto border-b border-[var(--hairline)] px-4 py-2">
          <button type="button" role="radio" aria-checked={!target} onClick={() => setTargetId(null)} className={pill(!target)}>
            New collection
          </button>
          {collections.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={c.id === targetId} onClick={() => setTargetId(c.id)} className={pill(c.id === targetId)}>
              {c.name} <span className="font-normal text-[var(--text-tertiary)] tabular-nums">{c.assets.length}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="max-h-[320px] overflow-y-auto py-1">
        {assets.map((a) => {
          const inIt = already.has(a.id);
          const on = !inIt && !dropped.has(a.id);
          return (
            <li key={a.id}>
              <label className={`flex items-center gap-3 px-4 py-1.5 ${inIt ? "" : "cursor-pointer [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.03]"}`}>
                <input type="checkbox" checked={on} disabled={inIt} onChange={() => toggle(a.id)} className="peer sr-only" />
                <span
                  aria-hidden
                  className={`flex size-[18px] shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] ${on ? "bg-[var(--accent)] ring-[var(--accent)]" : "ring-[var(--hairline-strong)]"}`}
                >
                  {on && <Check className="size-3 text-[var(--on-accent)]" strokeWidth={3} />}
                </span>
                <img src={thumb(a.id)} alt="" className={`size-9 shrink-0 rounded-[9px] bg-[var(--raised)] object-contain p-0.5 transition-opacity duration-150 ${on ? "" : "opacity-40"}`} />
                <span className={`min-w-0 flex-1 truncate text-[13px] transition-colors duration-150 ${on ? "text-[var(--text)]" : "text-[var(--text-tertiary)]"}`}>{a.name}</span>
                {inIt ? (
                  <span className="shrink-0 text-[12px] text-[var(--text-tertiary)]">Already in</span>
                ) : (
                  a.author && <span className="hidden shrink-0 text-[12px] text-[var(--text-tertiary)] sm:block">{a.author}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {error && <p className="border-t border-[var(--hairline)] px-4 py-2.5 text-[13px] text-amber-700">{error}</p>}

      <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--hairline)] py-2.5 pr-3 pl-4">
        {target ? (
          <span className="mr-auto text-[12.5px] text-[var(--text-tertiary)]">{target.discoverable ? "Visible to others" : "Only you can see it"}</span>
        ) : (
          <label className="mr-auto inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="peer sr-only" />
            <span
              aria-hidden
              className={`relative h-[18px] w-[30px] rounded-full transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] ${visible ? "bg-[var(--accent)]" : "bg-[var(--ink)]/15"}`}
            >
              <span className={`absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white transition-transform duration-150 ${visible ? "translate-x-[12px]" : ""}`} />
            </span>
            Visible to others
          </label>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="pressable rounded-full px-3 py-1.5 text-[13px] text-[var(--text-secondary)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--ink)]/[0.06] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="pressable rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--on-accent)] disabled:opacity-40"
        >
          {saving ? (target ? "Adding…" : "Creating…") : target ? `Add ${kept.length}` : `Create with ${kept.length}`}
        </button>
      </footer>
    </motion.section>
  );
}
