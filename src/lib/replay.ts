import { api } from "../api";
import { ACT_THRESHOLD, type Sort } from "../intent";
import { browseTitle, effectivePlan, filtersOf, wantsCheck } from "../plan";
import { route } from "../routed";
import { cleanQuery, sentenceCase } from "../surfaces";
import { refine, type Step, stepFrom, threadContext } from "../thread";

/** Re-runs a search and its follow-ups off screen, the way typing them would. */
export async function replaySearch(query: string, lines: string[], setSort: Sort, signal: AbortSignal): Promise<Step[]> {
  const intent = await api.intent(query, signal);
  const plan = effectivePlan(intent, {}, setSort);
  const input = { about: plan.browse ? browseTitle(plan) : (intent.plan.about ?? query), filters: filtersOf(plan), check: wantsCheck(intent), browse: plan.browse };
  const view = plan.set ? (plan.lineup ? "lineup" : "single") : intent.view.value === "none" || intent.view.confidence < ACT_THRESHOLD ? "single" : intent.view.value;
  const routed = await route(query, view, "fused", input, signal);
  const steps = [stepFrom(routed, plan, sentenceCase(cleanQuery("about" in routed ? routed.about : query)), query)];
  for (const line of lines) {
    const read = await api.intent(line, signal, threadContext(steps));
    steps.push(await refine(steps[steps.length - 1], read, line, signal));
  }
  return steps;
}
