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
  machineFloor,
  type MachineFloor,
  type ProducerType,
} from './chemistry'

export { routeBelts, type Grid, type PortRef } from './router'

export {
  enumeratePlans,
  canonicalPlan,
  machineCostOf,
  DEFAULT_PLAN_LIMITS,
  type Plan,
  type PlanNode,
  type PlanNodeKind,
  type PlanLimits,
} from './planner'
