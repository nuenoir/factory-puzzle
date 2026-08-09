/**
 * Does choosing a roomier cell beat taking the first free one?
 *
 * The rip-up experiment established that routing failures are not ordering
 * conflicts — they are bad placements that only surface at routing time. This
 * tests the implied fix. Instead of seizing the first free cell the jitter
 * lands on, collect K free candidates and take the one with the most free
 * neighbours, on the theory that a machine with one free neighbour cannot be
 * wired however it is rotated.
 *
 * Same paired protocol as the previous two experiments, and for the same
 * reason: acceptance moves by two or three, and any parameter change reshuffles
 * the whole PRNG stream. Four independent seed ranges, 200 candidates.
 *
 * Reports routing failures as well as acceptance, because that is the number
 * that exposed rip-up as a dead end. If placement really is the bottleneck,
 * this is the change that should finally move it.
 *
 *   node --experimental-strip-types scratchpad/confirm-placement-samples.ts
 */

import { runBatch, DEFAULT_CRITERIA, DEFAULT_GENERATOR_OPTIONS, DEFAULT_PLAN_LIMITS } from '../packages/gen/src/index.ts'

const SAMPLES = [1, 2, 3, 4, 6, 8]
const RANGES = [1, 101, 201, 301]

interface Cell {
  accepted: number
  twoPlus: number
  onePlus: number
  won: number
  routing: number
  placementFail: number
  ms: number
}

const results = new Map<string, Cell>()

for (const start of RANGES) {
  for (const placementSamples of SAMPLES) {
    const began = Date.now()
    const { records } = runBatch({
      count: 50,
      startSeed: start,
      criteria: DEFAULT_CRITERIA,
      generator: DEFAULT_GENERATOR_OPTIONS,
      limits: {
        ...DEFAULT_PLAN_LIMITS,
        attemptsPerPlan: 250,
        routeRetries: 2,
        placementSamples,
        timeoutMs: 60000,
      },
    })
    results.set(`${start}:${placementSamples}`, {
      accepted: records.filter((r) => r.accepted).length,
      twoPlus: records.filter((r) => r.distinct_forms >= 2).length,
      onePlus: records.filter((r) => r.distinct_forms >= 1).length,
      won: records.reduce((s, r) => s + r.tally.won, 0),
      routing: records.reduce((s, r) => s + r.tally.routing, 0),
      placementFail: records.reduce((s, r) => s + r.tally.placement, 0),
      ms: Date.now() - began,
    })
  }
}

const pad = (s: string | number, w = 9) => String(s).padStart(w)
const total = (k: keyof Cell, s: number) => RANGES.reduce((a, g) => a + results.get(`${g}:${s}`)![k], 0)

console.log('accepted out of 50, paired by seed range   (K = cells considered per machine)\n')
console.log(pad('seeds') + SAMPLES.map((s) => pad(`K=${s}`)).join(''))
for (const start of RANGES) {
  console.log(pad(`${start}-${start + 49}`) + SAMPLES.map((s) => pad(results.get(`${start}:${s}`)!.accepted)).join(''))
}
console.log(pad('TOTAL') + SAMPLES.map((s) => pad(total('accepted', s))).join(''))

console.log('\ntotals across all 200 candidates\n')
const metrics: [string, keyof Cell][] = [
  ['levels with >=1 solution', 'onePlus'],
  ['levels with >=2 forms', 'twoPlus'],
  ['winning attempts', 'won'],
  ['routing failures', 'routing'],
  ['placement failures', 'placementFail'],
  ['wall clock ms', 'ms'],
]
console.log(''.padEnd(26) + SAMPLES.map((s) => pad(`K=${s}`)).join(''))
for (const [label, k] of metrics) {
  console.log(label.padEnd(26) + SAMPLES.map((s) => pad(total(k, s))).join(''))
}

const base = total('won', 1)
console.log('\nwin rate relative to K=1: ' + SAMPLES.map((s) => `K=${s} ${((total('won', s) / base - 1) * 100).toFixed(1)}%`).join('   '))
