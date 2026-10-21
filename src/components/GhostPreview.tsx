import type { ReactNode } from "react";

export function GhostPreview({ ghost, children }: { ghost: boolean; children: ReactNode }) {
  return (
    <div
      className={`transition-[opacity,filter] duration-150 ease-out motion-reduce:transition-[opacity] ${
        ghost ? "pointer-events-none opacity-40 grayscale-[0.6] select-none motion-reduce:grayscale-0" : ""
      }`}
      aria-hidden={ghost || undefined}
      inert={ghost || undefined}
    >
      {children}
    </div>
  );
}
