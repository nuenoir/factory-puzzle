/** The run loop and scoring. docs/rules-spec.md §10, §11, §13. */

import { hasWon, tick } from './tick'
import { costOf, createWorld, footprintOf, stateKey, type World } from './world'
import type { Level, SimResult, Solution } from './types'

/**
 * Run a solution to completion.
 *
 * The same function is the game engine and the Phase 3 puzzle validator, which
 * is why it stays pure and free of rendering imports (CLAUDE.md).
 */
export function simulate(level: Level, solution: Solution): SimResult {
  const built = createWorld(level, solution)
  if (!built.ok) {
    // §13: nothing is simulated when validation fails, and nothing is scored —
    // computing cost or footprint from malformed placements would produce
    // garbage numbers (NaN footprints) next to the error list.
    return { won: false, ticks: 0, cost: 0, footprint: 0, jammed: false, errors: built.errors }
  }

  const cost = costOf(solution)
  const footprint = footprintOf(solution)

  const world = built.world
  let jammed = false

  while (world.tickCount < level.max_ticks) {
    const before = stateKey(world)
    tick(world)

    // §10: win is checked before fail, so a delivery on the final permitted
    // tick still wins.
    if (hasWon(world)) {
      return { won: true, ticks: world.tickCount, cost, footprint, jammed: false, errors: [] }
    }

    // §13: a fixpoint is permanent under determinism, so stop early — but the
    // reported tick count is still max_ticks.
    if (stateKey(world) === before) {
      jammed = true
      break
    }
  }

  return { won: false, ticks: level.max_ticks, cost, footprint, jammed, errors: [] }
}

/** Advance an already-built world by one tick. Exposed for §14's per-tick tests. */
export function step(world: World): void {
  tick(world)
}
