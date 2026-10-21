import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { tween } from "../motion";

type Morph = { prefix: string; incoming: string; outgoing: string; key: number };

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Keeps the letters two labels share still and morphs only the tail ("Import 2 assets" → "Importing…"). */
export function TextMorph({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const last = useRef(text);
  const [m, setM] = useState<Morph>({ prefix: text, incoming: "", outgoing: "", key: 0 });

  useLayoutEffect(() => {
    if (text === last.current) return;
    const p = sharedPrefix(last.current, text);
    setM((s) => ({ prefix: text.slice(0, p), incoming: text.slice(p), outgoing: last.current.slice(p), key: s.key + 1 }));
    last.current = text;
  }, [text]);

  const blur = reduce ? "blur(0px)" : "blur(2px)";
  return (
    <span className={`inline-flex whitespace-pre ${className ?? ""}`} aria-label={text}>
      <span aria-hidden>{m.prefix}</span>
      <span aria-hidden className="relative inline-block">
        <motion.span
          key={`in-${m.key}`}
          className="inline-block"
          initial={m.key === 0 ? false : { opacity: 0, transform: `translateY(${reduce ? 0 : 4}px)`, filter: blur }}
          animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
          transition={tween.morph}
        >
          {m.incoming}
        </motion.span>
        {m.outgoing && (
          <motion.span
            key={`out-${m.key}`}
            className="pointer-events-none absolute top-0 left-0 inline-block"
            initial={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
            animate={{ opacity: 0, transform: `translateY(${reduce ? 0 : -4}px)`, filter: blur }}
            transition={tween.morphOut}
            onAnimationComplete={() => setM((s) => (s.key === m.key ? { ...s, outgoing: "" } : s))}
          >
            {m.outgoing}
          </motion.span>
        )}
      </span>
    </span>
  );
}
