import { useState } from "react";
import type { Space } from "../api";
import { Calibrate } from "./Calibrate";
import { FollowUpCheck } from "./FollowUpCheck";
import { Pressable } from "./Pressable";

const CHECKS = [
  ["membership", "Membership"],
  ["followups", "Follow-ups"],
] as const;

export function Checks({ space }: { space: Space }) {
  const [check, setCheck] = useState<(typeof CHECKS)[number][0]>("membership");
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-8">
      <div role="tablist" className="inline-flex rounded-full bg-[var(--ink)]/[0.04] p-0.5 text-[12px] ring-1 ring-[var(--hairline)]">
        {CHECKS.map(([id, label]) => (
          <Pressable
            key={id}
            role="tab"
            aria-selected={check === id}
            onClick={() => setCheck(id)}
            className={`rounded-full px-3 py-1 ${check === id ? "bg-[var(--ink)]/10 text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
          >
            {label}
          </Pressable>
        ))}
      </div>
      {check === "membership" ? <Calibrate space={space} /> : <FollowUpCheck />}
    </div>
  );
}
