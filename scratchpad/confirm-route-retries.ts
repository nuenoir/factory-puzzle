/**
 * Is the routeRetries gain real, or is 50 candidates just a small sample?
 *
 * The sweep showed accepted doubling from 3 to 6, but acceptance counts that
 * small move around, and changing a search parameter reshuffles the entire
 * random sequence — so an arm can look better for no reason at all. This runs
 * the same comparison over four independent batches of 50 levels and pairs them
 * by seed range, which is the only way the difference means anything.
 *
 * Also reports distinct forms found, because acceptance needs *two* materially
 * different solutions (§5) and the interesting hypothesis is that retrying the
 * wiring does not win much more often overall — it wins on the awkward second
 * plan that placement alone could never route.
 *
 *   node --experimental-strip-types scratchpad/confirm-route-retries.ts
 */

import { runBatch, DEFAULT_CRITERIA, DEFAULT_GENERATOR_OPTIONS, DEFAULT_PLAN_LIMITS } from '../packages/gen/src/index.ts'

const RETRIES = [1, 2, 4]
const RANGES = [1, 101, 201, 301]

interface Cell {
  accepted: number
  twoPlus: number
  onePlus: number
  forms: number
  won: number
  ms: number
}

const results = new Map<string, Cell>()

for (const start of RANGES) {
  for (const routeRetries of RETRIES) {
    const began = Date.now()
    const { records } = runBatch({
      count: 50,
      startSeed: start,
      criteria: DEFAULT_CRITERIA,
      generator: DEFAULT_GENERATOR_OPTIONS,
      limits: { ...DEFAULT_PLAN_LIMITS, attemptsPerPlan: 250, routeRetries, timeoutMs: 60000 },
    })
    results.set(`${start}:${routeRetries}`, {
      accepted: records.filter((r) => r.accepted).length,
      twoPlus: records.filter((r) => r.distinct_forms >= 2).length,
      onePlus: records.filter((r) => r.distinct_forms >= 1).length,
      forms: records.reduce((s, r) => s + r.distinct_forms, 0),
      won: records.reduce((s, r) => s + r.tally.won, 0),
      ms: Date.now() - began,
    })
  }
}

console.log('accepted out of 50, paired by seed range\n')
console.log(['seeds', ...RETRIES.map((r) => `R=${r}`)].map((h) => h.padStart(9)).join(''))
for (const start of RANGES) {
  const cells = RETRIES.map((r) => String(results.get(`${start}:${r}`)!.accepted).padStart(9))
  console.log(`${String(`${start}-${start + 49}`).padStart(9)}${cells.join('')}`)
}
const totalAccepted = RETRIES.map((r) => RANGES.reduce((s, g) => s + results.get(`${g}:${r}`)!.accepted, 0))
console.log(`${'TOTAL'.padStart(9)}${totalAccepted.map((n) => String(n).padStart(9)).join('')}`)

console.log('\nwhy — totals across all 200 candidates\n')
const metrics: [string, keyof Cell][] = [
  ['levels with >=1 solution', 'onePlus'],
  ['levels with >=2 forms', 'twoPlus'],
  ['distinct forms found', 'forms'],
  ['winning attempts', 'won'],
  ['wall clock ms', 'ms'],
]
console.log(['', ...RETRIES.map((r) => `R=${r}`)].map((h, i) => (i === 0 ? h.padEnd(26) : h.padStart(9))).join(''))
for (const [label, key] of metrics) {
  const cells = RETRIES.map((r) => String(RANGES.reduce((s, g) => s + results.get(`${g}:${r}`)![key], 0)).padStart(9))
  console.log(`${label.padEnd(26)}${cells.join('')}`)
}
