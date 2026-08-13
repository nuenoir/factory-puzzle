/**
 * What a tick means for the run.
 *
 * Extracted from the component so it can be checked without a renderer. The
 * ordering here is §10 of the rules spec and not a matter of taste: a factory
 * that completes its order on the very tick the clock runs out has **won**, and
 * a jam is only a jam once the world stops changing. Deciding those in the
 * wrong order costs somebody a legitimate win.
 */

export type StepOutcome = 'running' | 'won' | 'jammed' | 'timeout'

export interface StepFacts {
  /** Of the target type only — other deliveries do not count towards the order. */
  readonly delivered: number
  readonly target: number
  readonly tickCount: number
  readonly maxTicks: number
  /**
   * True when the tick changed nothing at all.
   *
   * §13: the simulation is deterministic, so a state that repeats itself will
   * repeat forever. That is what makes a single unchanged tick sufficient
   * evidence of a jam rather than a reason to wait and see.
   */
  readonly stalled: boolean
}

export function statusAfterStep(facts: StepFacts): StepOutcome {
  // §10 — the win is checked first, then the tick limit.
  if (facts.delivered >= facts.target) return 'won'
  if (facts.tickCount >= facts.maxTicks) return 'timeout'
  if (facts.stalled) return 'jammed'
  return 'running'
}
