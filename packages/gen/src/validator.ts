/**
 * The four acceptance criteria. docs/generation-spec.md §3, §4, §6.
 *
 * Checks run cheapest-first, so a candidate rejected on chemistry never pays
 * for a placement search. The verdict records which stage decided, because
 * that is what separates a proof from a bounded search coming up empty — and
 * conflating those two would overstate what this validator knows.
 */

import { COST, type Level, type Solution } from '@factory/sim'

import { isProducible, machineFloor } from './chemistry.ts'
import { DEFAULT_SEARCH_LIMITS, solve, type AttemptTally, type SearchLimits } from './solver.ts'

/** §6. Exactly one of these, or null on acceptance. */
export type RejectionCode =
  | 'unsolvable_chemistry'
  | 'over_budget_floor'
  | 'no_solution_found'
  | 'trivial'
  | 'over_budget'
  | 'single_solution'

export interface Criteria {
  /** §3.2 — below this a puzzle is not worth playing. */
  readonly minCost: number
  /** §3.3 — above this it will not fit a three-minute daily. */
  readonly maxCost: number
}

export const DEFAULT_CRITERIA: Criteria = { minCost: 8, maxCost: 30 }

export interface Verdict {
  readonly accepted: boolean
  readonly reason: RejectionCode | null
  /** Which stage decided. 'A' and 'B' are proofs; 'C' is a bounded search. */
  readonly stage: 'A' | 'B' | 'C'
  readonly solutionsFound: number
  readonly distinctForms: number
  readonly cheapestCost: number | null
  /** §2 — computed, never proposed. Null unless the candidate was accepted. */
  readonly par: number | null
  readonly floorCost: number | null
  readonly bound: {
    readonly attemptsPerPlan: number
    readonly timeoutMs: number
    readonly plansTried: number
    readonly attempts: number
    /** False means the search was cut short, so silence proves nothing. */
    readonly exhausted: boolean
  }
  readonly tally: AttemptTally
}

const EMPTY_TALLY: AttemptTally = { placement: 0, ports: 0, routing: 0, simulation: 0, won: 0 }

function reject(
  reason: RejectionCode,
  stage: Verdict['stage'],
  limits: SearchLimits,
  extra: Partial<Verdict> = {},
): Verdict {
  return {
    accepted: false,
    reason,
    stage,
    solutionsFound: 0,
    distinctForms: 0,
    cheapestCost: null,
    par: null,
    floorCost: null,
    bound: { ...limits, plansTried: 0, attempts: 0, exhausted: true },
    tally: EMPTY_TALLY,
    ...extra,
  }
}

/** §3.2 — a factory of nothing but belts is routing practice, not a puzzle. */
function usesOnlyConveyors(solution: Solution): boolean {
  return solution.placements.every((p) => p.type === 'conveyor')
}

export function validate(
  level: Level,
  seed: number,
  criteria: Criteria = DEFAULT_CRITERIA,
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
  now: () => number = Date.now,
): Verdict {
  // Stage A — exact. A rejection here is a proof, not a failure to find.
  if (!isProducible(level)) return reject('unsolvable_chemistry', 'A', limits)

  // Stage B — exact lower bound, so this rejection is a proof too.
  const floor = machineFloor(level)
  if (floor === null) return reject('unsolvable_chemistry', 'A', limits)
  if (floor.cost > criteria.maxCost) {
    return reject('over_budget_floor', 'B', limits, { floorCost: floor.cost })
  }

  // Stage C — bounded. Everything below is "within the search we allowed".
  const outcome = solve(level, seed, limits, now)
  const bound = {
    ...limits,
    plansTried: outcome.plansTried,
    attempts: outcome.attempts,
    exhausted: outcome.exhausted,
  }
  const common = {
    stage: 'C' as const,
    solutionsFound: outcome.solutions.length,
    distinctForms: outcome.distinctForms,
    cheapestCost: outcome.cheapest?.cost ?? null,
    floorCost: floor.cost,
    bound,
    tally: outcome.tally,
  }

  if (outcome.cheapest === null) {
    return { accepted: false, reason: 'no_solution_found', par: null, ...common }
  }

  const cheapest = outcome.cheapest
  if (cheapest.cost < criteria.minCost || usesOnlyConveyors(cheapest.solution)) {
    return { accepted: false, reason: 'trivial', par: null, ...common }
  }
  if (cheapest.cost > criteria.maxCost) {
    return { accepted: false, reason: 'over_budget', par: null, ...common }
  }
  // §5 — one verified solution per materially different idea.
  if (outcome.distinctForms < 2) {
    return { accepted: false, reason: 'single_solution', par: null, ...common }
  }

  return { accepted: true, reason: null, par: cheapest.cost, ...common }
}

/** The accepted level, with its computed par written in (§2). */
export function withComputedPar(level: Level, verdict: Verdict): Level {
  return verdict.par === null ? level : { ...level, par: verdict.par }
}

export { COST }
