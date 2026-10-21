import type { Transition } from "motion/react";

export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const;

export const spring = {
  morph: { type: "spring", duration: 0.4, bounce: 0 },
  homePrompt: { type: "spring", duration: 0.35, bounce: 0 },
} as const satisfies Record<string, Transition>;

export const tween = {
  trayEnter: { duration: 0.28, ease: ease.drawer },
  trayExit: { duration: 0.18, ease: ease.out },
  fade: { duration: 0.15, ease: ease.out },
  morph: { duration: 0.24, ease: ease.out },
  morphOut: { duration: 0.16, ease: ease.out },
  strip: { duration: 0.22, ease: ease.out },
} as const;
