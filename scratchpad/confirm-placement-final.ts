/**
 * Final check on the placement heuristic, paired by seed range.
 *
 * Two arms only. The sweeps in the sibling harnesses explored the space; this
 * confirms the one candidate against the one baseline, because picking a winner
 * out of six arms on differences of two or three is how you end up shipping
 * noise.
 *
 * `solve` alternates: even restarts take the first free cell, odd restarts pick
 * the roomiest of K. That alternation is the whole design. Sampling only for
 * room finds more layouts but spreads the machines, and spread machines need
 * longer belts — so a purely roomy search stops finding the cheap compact
 * solutions and `par` drifts upward, which is a worse failure than accepting
 * fewer puzzles.
 *
 * Reports both axes because they can move in opposite directions:
 *   accepted   — how many puzzles clear all four criteria
 *   par excess — how far the reported par sits above the cheapest cost either
 *                arm managed to find, over levels both solved
 *
 *   node --experimental-strip-types scratchpad/confirm-placement-final.ts
 */

import { runBatch, DEFAULT_CRITERIA, DEFAULT_GENERATOR_OPTIONS, DEFAULT_SEARCH_LIMITS } from '../packages/gen/src/index.ts'

const ARMS = [
  { label: '250 tight', placementSamples: 1, attemptsPerPlan: 250 }, // today
  { label: '500 tight', placementSamples: 1, attemptsPerPlan: 500 }, // budget control
  { label: '125+125', placementSamples: 4, attemptsPerPlan: 250 }, // equal budget
  { label: '250+250', placementSamples: 4, attemptsPerPlan: 500 }, // candidate
]
const RANGES = [1, 101, 201, 301]

interface Cell {
  accepted: number
  costs: Map<string, number>
  won: number
  routing: number
  ms: number
}

const results = new Map<string, Cell>()

for (const start of RANGES) {
  for (const arm of ARMS) {
    const began = Date.now()
    const { records } = runBatch({
      count: 50,
      startSeed: start,
      criteria: DEFAULT_CRITERIA,
      generator: DEFAULT_GENERATOR_OPTIONS,
      limits: {
        ...DEFAULT_SEARCH_LIMITS,
        placementSamples: arm.placementSamples,
        attemptsPerPlan: arm.attemptsPerPlan,
        timeoutMs: 60000,
      },
    })
    const costs = new Map<string, number>()
    for (const r of records) if (r.cheapest_cost !== null) costs.set(r.id, r.cheapest_cost)
    results.set(`${start}:${arm.label}`, {
      accepted: records.filter((r) => r.accepted).length,
      costs,
      won: records.reduce((s, r) => s + r.tally.won, 0),
      routing: records.reduce((s, r) => s + r.tally.routing, 0),
      ms: Date.now() - began,
    })
  }
}

const pad = (s: string | number, w = 11) => String(s).padStart(w)
const sum = (label: string, k: 'accepted' | 'won' | 'routing' | 'ms') =>
  RANGES.reduce((a, g) => a + results.get(`${g}:${label}`)![k], 0)

console.log('accepted out of 50, paired by seed range\n')
console.log(pad('seeds', 9) + ARMS.map((a) => pad(a.label)).join(''))
for (const start of RANGES) {
  console.log(pad(`${start}-${start + 49}`, 9) + ARMS.map((a) => pad(results.get(`${start}:${a.label}`)!.accepted)).join(''))
}
console.log(pad('TOTAL', 9) + ARMS.map((a) => pad(sum(a.label, 'accepted'))).join(''))

// Par excess against the best cost ANY arm found, over levels every arm solved.
const best = new Map<string, number>()
for (const start of RANGES) {
  for (const arm of ARMS) {
    for (const [id, cost] of results.get(`${start}:${arm.label}`)!.costs) {
      const seen = best.get(id)
      if (seen === undefined || cost < seen) best.set(id, cost)
    }
  }
}
const common = [...best.keys()].filter((id) =>
  RANGES.some((g) => ARMS.every((a) => results.get(`${g}:${a.label}`)!.costs.has(id))),
)

const excess = new Map<string, { mean: number; off: number; n: number }>()
for (const arm of ARMS) {
  let total = 0
  let off = 0
  let n = 0
  for (const start of RANGES) {
    const mine = results.get(`${start}:${arm.label}`)!.costs
    for (const id of common) {
      const cost = mine.get(id)
      if (cost === undefined) continue
      n += 1
      const gap = cost - best.get(id)!
      total += gap
      if (gap > 0) off += 1
    }
  }
  excess.set(arm.label, { mean: total / n, off, n })
}

console.log('\ntotals across all 200 candidates\n')
console.log(''.padEnd(24) + ARMS.map((a) => pad(a.label)).join(''))
console.log('winning attempts'.padEnd(24) + ARMS.map((a) => pad(sum(a.label, 'won'))).join(''))
console.log('routing failures'.padEnd(24) + ARMS.map((a) => pad(sum(a.label, 'routing'))).join(''))
console.log('wall clock ms'.padEnd(24) + ARMS.map((a) => pad(sum(a.label, 'ms'))).join(''))
console.log(`par excess (mean)`.padEnd(24) + ARMS.map((a) => pad(excess.get(a.label)!.mean.toFixed(3))).join(''))
console.log('levels with looser par'.padEnd(24) + ARMS.map((a) => pad(excess.get(a.label)!.off)).join(''))
console.log(`\ncompared over ${excess.get(ARMS[0].label)!.n} levels both arms solved`)
