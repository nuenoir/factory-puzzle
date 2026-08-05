/**
 * Does retrying the wiring beat re-placing the machines?
 *
 * 95% of placement attempts die at routing, and every one of those throws away
 * a placement that was fine — the machines were down, one belt run could not
 * find a lane. `routeRetries` re-pairs the ports and re-orders the belt runs on
 * the same placement instead. This measures whether that is actually better,
 * because the last plausible-sounding search change (sampling runner-up machine
 * rotations) measurably hurt and was reverted.
 *
 * Two framings, because only the second one settles it:
 *
 *   equal placements — same attemptsPerPlan, more work per attempt. Answers
 *     "does retrying help at all", but it is not a fair fight: arm R=8 is
 *     allowed to do far more routing than arm R=1.
 *   equal work — attemptsPerPlan divided by R, so total routing passes are
 *     roughly held constant. Answers the question that matters, which is
 *     whether a fixed budget is better spent re-wiring or re-placing.
 *
 * The timeout is deliberately generous so no arm is cut short; a verdict that
 * came from the clock rather than the search would not be comparable.
 *
 *   node --experimental-strip-types scratchpad/sweep-route-retries.ts
 */

import { runBatch, summarise, DEFAULT_CRITERIA, DEFAULT_GENERATOR_OPTIONS, DEFAULT_PLAN_LIMITS } from '../packages/gen/src/index.ts'

interface Arm {
  readonly label: string
  readonly attemptsPerPlan: number
  readonly routeRetries: number
}

const arms: Arm[] = [
  // Equal placements: 250 each, R varies.
  { label: 'R=1  (today)', attemptsPerPlan: 250, routeRetries: 1 },
  { label: 'R=2', attemptsPerPlan: 250, routeRetries: 2 },
  { label: 'R=3', attemptsPerPlan: 250, routeRetries: 3 },
  { label: 'R=4', attemptsPerPlan: 250, routeRetries: 4 },
  { label: 'R=6', attemptsPerPlan: 250, routeRetries: 6 },
  { label: 'R=8', attemptsPerPlan: 250, routeRetries: 8 },
  // Equal work: attempts x R held at ~250 routing passes.
  { label: 'R=2  @125 att', attemptsPerPlan: 125, routeRetries: 2 },
  { label: 'R=4  @63 att', attemptsPerPlan: 63, routeRetries: 4 },
  { label: 'R=8  @31 att', attemptsPerPlan: 31, routeRetries: 8 },
]

const header = ['setting', 'acc', 'noPlace', 'single', 'overBud', 'won', 'routeFail', 'placements', 'cut', 'ms']
const widths = [14, 4, 8, 7, 8, 6, 10, 11, 4, 6]
const row = (cells: (string | number)[]) =>
  cells.map((c, i) => String(c).padStart(i === 0 ? -widths[i] : widths[i])).join('  ')

console.log(header.map((h, i) => (i === 0 ? h.padEnd(widths[0]) : h.padStart(widths[i]))).join('  '))
console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)))

for (const arm of arms) {
  const started = Date.now()
  const { records } = runBatch({
    count: 50,
    startSeed: 1,
    criteria: DEFAULT_CRITERIA,
    generator: DEFAULT_GENERATOR_OPTIONS,
    limits: {
      ...DEFAULT_PLAN_LIMITS,
      attemptsPerPlan: arm.attemptsPerPlan,
      routeRetries: arm.routeRetries,
      timeoutMs: 60000, // generous on purpose; nothing should be cut short
    },
  })
  const elapsed = Date.now() - started

  const summary = summarise(records)
  const count = (reason: string) => summary.rejections.find((r) => r.reason === reason)?.count ?? 0
  const tally = records.reduce(
    (a, r) => ({ won: a.won + r.tally.won, routing: a.routing + r.tally.routing }),
    { won: 0, routing: 0 },
  )
  const placements = records.reduce((s, r) => s + r.bound.attempts, 0)

  console.log(
    [
      arm.label.padEnd(widths[0]),
      String(summary.accepted).padStart(widths[1]),
      String(count('no_placement_found')).padStart(widths[2]),
      String(count('single_solution')).padStart(widths[3]),
      String(count('over_budget')).padStart(widths[4]),
      String(tally.won).padStart(widths[5]),
      String(tally.routing).padStart(widths[6]),
      String(placements).padStart(widths[7]),
      String(summary.cutShort).padStart(widths[8]),
      String(elapsed).padStart(widths[9]),
    ].join('  '),
  )
}

console.log(`
acc        accepted out of 50 — the number that actually matters
noPlace    no_placement_found: plans existed, no layout of them won
won        attempts that produced a winning factory
routeFail  attempts that died at routing
placements total attempts, i.e. how many times machines were placed afresh
cut        searches stopped by the clock rather than finishing (want 0)`)
