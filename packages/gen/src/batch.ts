/**
 * The batch and its rejection log. docs/generation-spec.md §6, §7.
 *
 * The log is the deliverable, not a by-product: the roadmap's gate is 50+
 * candidates with the breakdown written up. So every record carries not only
 * *that* a candidate was rejected but which stage decided and whether the
 * search ran to completion — the difference between "we proved it" and "we
 * looked as far as we allowed ourselves to".
 *
 * Pure: it returns records and writes nothing. The CLI does the file I/O.
 */

import type { Level } from '@factory/sim'

import { generateLevel, type GeneratorOptions, DEFAULT_GENERATOR_OPTIONS } from './generator.ts'
import {
  validate,
  withComputedPar,
  type Criteria,
  type RejectionCode,
  type Verdict,
  DEFAULT_CRITERIA,
} from './validator.ts'
import { DEFAULT_SEARCH_LIMITS, type SearchLimits } from './solver.ts'

export interface CandidateRecord {
  readonly id: string
  readonly seed: number
  readonly accepted: boolean
  readonly reason: Verdict['reason']
  readonly stage: Verdict['stage']
  /** Wall clock, and the one field §7 exempts from reproducing exactly. */
  readonly elapsed_ms: number
  readonly solutions_found: number
  readonly distinct_forms: number
  readonly cheapest_cost: number | null
  readonly floor_cost: number | null
  readonly par: number | null
  readonly bound: Verdict['bound']
  readonly tally: Verdict['tally']
}

export interface BatchOptions {
  readonly count: number
  readonly startSeed: number
  readonly criteria: Criteria
  readonly limits: SearchLimits
  readonly generator: GeneratorOptions
}

export const DEFAULT_BATCH_OPTIONS: Omit<BatchOptions, 'count' | 'startSeed'> = {
  criteria: DEFAULT_CRITERIA,
  limits: DEFAULT_SEARCH_LIMITS,
  generator: DEFAULT_GENERATOR_OPTIONS,
}

export interface BatchResult {
  readonly records: readonly CandidateRecord[]
  /** Accepted levels, each with its computed par written in. */
  readonly accepted: readonly Level[]
}

export function runBatch(options: BatchOptions, now: () => number = Date.now): BatchResult {
  const records: CandidateRecord[] = []
  const accepted: Level[] = []

  for (let i = 0; i < options.count; i += 1) {
    const seed = options.startSeed + i
    const level = generateLevel(seed, options.generator)

    const started = now()
    const verdict = validate(level, seed, options.criteria, options.limits, now)
    const elapsed = now() - started

    records.push({
      id: level.id,
      seed,
      accepted: verdict.accepted,
      reason: verdict.reason,
      stage: verdict.stage,
      elapsed_ms: elapsed,
      solutions_found: verdict.solutionsFound,
      distinct_forms: verdict.distinctForms,
      cheapest_cost: verdict.cheapestCost,
      floor_cost: verdict.floorCost,
      par: verdict.par,
      bound: verdict.bound,
      tally: verdict.tally,
    })

    if (verdict.accepted) accepted.push(withComputedPar(level, verdict))
  }

  return { records, accepted }
}

export interface BatchSummary {
  readonly total: number
  readonly accepted: number
  /** Counts per rejection code, and the claim strength of each. */
  readonly rejections: ReadonlyArray<{ reason: RejectionCode; count: number; proven: boolean }>
  /** How many stage-C verdicts hit a cap rather than finishing their search. */
  readonly cutShort: number
}

/**
 * §4 — only stages A and B produce proofs. Stage C is bounded, both of its
 * empty-handed codes included: one is bounded by the plan caps and the other by
 * the attempt cap, but neither is evidence that no solution exists.
 */
const PROVEN: ReadonlySet<RejectionCode> = new Set<RejectionCode>([
  'unsolvable_chemistry',
  'over_budget_floor',
  'insufficient_fanout',
])

export function summarise(records: readonly CandidateRecord[]): BatchSummary {
  const counts = new Map<RejectionCode, number>()
  for (const record of records) {
    if (record.reason === null) continue
    counts.set(record.reason, (counts.get(record.reason) ?? 0) + 1)
  }

  return {
    total: records.length,
    accepted: records.filter((r) => r.accepted).length,
    rejections: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => ({ reason, count, proven: PROVEN.has(reason) })),
    cutShort: records.filter((r) => r.stage === 'C' && !r.bound.exhausted).length,
  }
}

/** §6 — one JSON object per line, so a crash keeps everything already written. */
export function toJsonl(records: readonly CandidateRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n'
}
