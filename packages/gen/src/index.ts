/**
 * Puzzle generation and validation. docs/generation-spec.md.
 *
 * The validator *is* `simulate` — that is why the simulator carries no
 * rendering imports and no randomness. All randomness in this project lives
 * here, seeded, so a candidate is reproducible from its seed alone (§7).
 */

export {
  reachableTypes,
  isProducible,
  deliverableWithoutFanout,
  machineFloor,
  type MachineFloor,
  type ProducerType,
} from './chemistry.ts'

export { routeBelts, type Grid, type PortRef } from './router.ts'

export {
  enumeratePlans,
  canonicalPlan,
  machineCostOf,
  DEFAULT_PLAN_LIMITS,
  type Plan,
  type PlanNode,
  type PlanNodeKind,
  type PlanLimits,
} from './planner.ts'

export { solve, DEFAULT_SEARCH_LIMITS, type SearchLimits, type SolveOutcome, type AttemptTally } from './solver.ts'

export {
  validate,
  withComputedPar,
  ALL_REJECTION_CODES,
  DEFAULT_CRITERIA,
  type Criteria,
  type RejectionCode,
  type Verdict,
} from './validator.ts'

export {
  generateLevel,
  DEFAULT_GENERATOR_OPTIONS,
  type GeneratorOptions,
} from './generator.ts'

export {
  runBatch,
  summarise,
  toJsonl,
  DEFAULT_BATCH_OPTIONS,
  type BatchOptions,
  type BatchResult,
  type BatchSummary,
  type CandidateRecord,
} from './batch.ts'
