/**
 * Does offering a second route to the target produce more varied puzzles?
 *
 * `single_solution` became the largest rejection class once the search stopped
 * being the limit, and that is a fact about the generator: it emitted at most
 * one assembler recipe, so the only structure that could ever satisfy
 * criterion 4 was an `x + x` pair with a splitter. Every other level had
 * exactly one plan and was rejected however well the search performed.
 *
 * IMPORTANT — this is not a search-tuning measurement and the previous three
 * harnesses' logic does not carry over. Changing the generator changes the
 * *levels*, so a seed no longer names the same puzzle in both arms. Nothing
 * can be paired per level, and par cannot be compared at all: a different
 * level has a different correct par, and a change in mean par says nothing
 * about honesty. What can be compared is the shape of the output.
 *
 * The thing to watch for is laundering. Acceptance can always be raised by
 * making every candidate easy, and that would gut the rejection log, which §2
 * says is the actual deliverable. So this reports the whole rejection mix and
 * the distinct-form distribution, not just the acceptance rate — a healthy
 * result keeps the proven rejections roughly intact and converts
 * `single_solution` into acceptances rather than erasing every failure.
 *
 *   node --experimental-strip-types scratchpad/confirm-alternative-routes.ts
 */

import {
  runBatch,
  summarise,
  ALL_REJECTION_CODES,
  DEFAULT_CRITERIA,
  DEFAULT_GENERATOR_OPTIONS,
  DEFAULT_SEARCH_LIMITS,
} from '../packages/gen/src/index.ts'

const ARMS = [
  { label: 'one route', alternativeRoutes: false },
  { label: 'alt routes', alternativeRoutes: true },
]
const RANGES = [1, 101, 201, 301]

interface Cell {
  accepted: number
  reasons: Map<string, number>
  forms: number[]
  plans: number
  ms: number
}

const results = new Map<string, Cell>()

for (const arm of ARMS) {
  const reasons = new Map<string, number>()
  const forms: number[] = []
  let accepted = 0
  let plans = 0
  const began = Date.now()

  for (const startSeed of RANGES) {
    const { records } = runBatch({
      count: 50,
      startSeed,
      criteria: DEFAULT_CRITERIA,
      generator: { ...DEFAULT_GENERATOR_OPTIONS, alternativeRoutes: arm.alternativeRoutes },
      limits: { ...DEFAULT_SEARCH_LIMITS, timeoutMs: 60000 },
    })
    for (const r of records) {
      if (r.accepted) accepted += 1
      if (r.reason !== null) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1)
      forms.push(r.distinct_forms)
      plans += r.bound.plansTried
    }
  }
  results.set(arm.label, { accepted, reasons, forms, plans, ms: Date.now() - began })
}

const pad = (s: string | number, w = 12) => String(s).padStart(w)

console.log('rejection mix over 200 candidates (four seed ranges)\n')
console.log('reason'.padEnd(24) + ARMS.map((a) => pad(a.label)).join(''))
console.log('accepted'.padEnd(24) + ARMS.map((a) => pad(results.get(a.label)!.accepted)).join(''))
for (const code of ALL_REJECTION_CODES) {
  const row = ARMS.map((a) => pad(results.get(a.label)!.reasons.get(code) ?? 0))
  if (row.every((c) => c.trim() === '0')) continue
  console.log(code.padEnd(24) + row.join(''))
}

console.log('\ndistinct forms found per candidate\n')
console.log('forms'.padEnd(24) + ARMS.map((a) => pad(a.label)).join(''))
for (const n of [0, 1, 2, 3]) {
  const label = n === 3 ? '3 or more' : String(n)
  console.log(
    label.padEnd(24) +
      ARMS.map((a) => pad(results.get(a.label)!.forms.filter((f) => (n === 3 ? f >= 3 : f === n)).length)).join(''),
  )
}

console.log('\nplans enumerated'.padEnd(25) + ARMS.map((a) => pad(results.get(a.label)!.plans)).join(''))
console.log('wall clock ms'.padEnd(24) + ARMS.map((a) => pad(results.get(a.label)!.ms)).join(''))

console.log(`
Healthy: single_solution falls and acceptance rises, while the proven codes
(unsolvable_chemistry, insufficient_fanout) stay broadly intact. If those
collapse too, the generator has started screening itself and the rejection log
— the actual deliverable — is worth less than it was.`)
