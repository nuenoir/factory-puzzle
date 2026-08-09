/**
 * Does the roomier placement heuristic buy acceptance at the cost of par?
 *
 * Preferring cells with free neighbours spreads machines out, and spread-out
 * machines need longer belt runs, which cost more. So the search can find
 * *more* solutions while losing the *cheap* ones — and par is the cheapest
 * solution found, which makes that a quiet regression in the number the player
 * is scored against. Acceptance and par quality are not the same axis.
 *
 * Two rules this harness exists to obey:
 *
 *   Compare only on levels every arm solved. Summing par over accepted levels
 *   is meaningless when the arms accept different sets — the arm that accepts
 *   more has a larger sum for that reason alone. An earlier harness here made
 *   exactly that mistake and its parSum column was discarded.
 *
 *   Measure against the best cost *any* arm found, not against the baseline.
 *   The baseline is not truth, it is just another arm; scoring everyone
 *   against it flatters it by construction.
 *
 * `solve` alternates tight and roomy placements per restart, so K is the roomy
 * half's sample count and K=1 disables the heuristic entirely.
 *
 *   node --experimental-strip-types scratchpad/confirm-placement-par.ts
 */

import { runBatch, DEFAULT_CRITERIA, DEFAULT_GENERATOR_OPTIONS, DEFAULT_SEARCH_LIMITS } from '../packages/gen/src/index.ts'

const ARMS = [1, 2, 4, 6]
const RANGES = [1, 101, 201, 301]

interface Arm {
  costs: Map<string, number>
  accepted: number
  won: number
  routing: number
  ms: number
}

function run(placementSamples: number): Arm {
  const costs = new Map<string, number>()
  let accepted = 0
  let won = 0
  let routing = 0
  const began = Date.now()
  for (const startSeed of RANGES) {
    const { records } = runBatch({
      count: 50,
      startSeed,
      criteria: DEFAULT_CRITERIA,
      generator: DEFAULT_GENERATOR_OPTIONS,
      limits: { ...DEFAULT_SEARCH_LIMITS, placementSamples, timeoutMs: 60000 },
    })
    for (const r of records) {
      if (r.cheapest_cost !== null) costs.set(r.id, r.cheapest_cost)
      if (r.accepted) accepted += 1
      won += r.tally.won
      routing += r.tally.routing
    }
  }
  return { costs, accepted, won, routing, ms: Date.now() - began }
}

const arms = new Map(ARMS.map((s) => [s, run(s)]))

// Best cost anyone found, per level. The closest thing to truth available.
const best = new Map<string, number>()
for (const arm of arms.values()) {
  for (const [id, cost] of arm.costs) {
    const seen = best.get(id)
    if (seen === undefined || cost < seen) best.set(id, cost)
  }
}
// Only levels every arm solved, so the comparison is like for like.
const common = [...best.keys()].filter((id) => ARMS.every((s) => arms.get(s)!.costs.has(id)))

console.log(`par quality over the ${common.length} levels every arm solved`)
console.log('excess = how far this arm\'s par sits above the best cost anyone found\n')
console.log('  K   accepted      won   routeFail   mean excess   levels off best      ms')

for (const s of ARMS) {
  const arm = arms.get(s)!
  let excess = 0
  let off = 0
  for (const id of common) {
    const gap = arm.costs.get(id)! - best.get(id)!
    excess += gap
    if (gap > 0) off += 1
  }
  console.log(
    `  ${String(s).padEnd(3)} ${String(arm.accepted).padStart(8)} ${String(arm.won).padStart(8)}` +
      `${String(arm.routing).padStart(12)}${(excess / common.length).toFixed(3).padStart(14)}` +
      `${String(off).padStart(18)}${String(arm.ms).padStart(8)}`,
  )
}

console.log(`
Lower mean excess is a tighter, more honest par. Watch it against the accepted
column: if they move in opposite directions the heuristic is buying puzzles by
mis-scoring them, which is the worse trade.`)
