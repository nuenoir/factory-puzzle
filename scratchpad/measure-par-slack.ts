/**
 * How loose is the shipped pool's par?
 *
 *   node --experimental-strip-types scratchpad/measure-par-slack.ts
 *
 * `par` is the cheapest solution the validator's bounded search *found*, never
 * proven optimal — CLAUDE.md records a router change that dropped one level's
 * par from 26 to 21. A sample of 26 pool levels suggested a harder search beats
 * the stored par on 42% of them, by up to 7. That is a big enough number to
 * decide something about, and too small a sample to decide it on.
 *
 * So this re-solves every level in `levels/daily.json` with a strictly larger
 * budget than the one that set its par, and verifies each cheaper solution by
 * running it through `simulate` — a solver cost that no simulation confirms is
 * exactly the kind of number this project does not accept.
 *
 * **This measures; it does not change anything.** Two reasons to keep it that
 * way. Raising the search budget in `DEFAULT_SEARCH_LIMITS` would re-score the
 * 50-candidate batch that docs/writeup.md publishes, which CLAUDE.md calls
 * load-bearing for a document that exists in the world. And tightening par has
 * a second-order effect worth seeing before choosing: par is also what
 * `MIN_DAILY_PAR` filters on, so a level whose par drops far enough stops being
 * a puzzle the daily loop should deal out at all.
 */

import { writeFileSync } from 'node:fs'

import { DEFAULT_SEARCH_LIMITS, solve } from '../packages/gen/src/index.ts'
import { simulate, type Level } from '@factory/sim'

import pool from '../levels/daily.json' with { type: 'json' }

/** The floor `scratchpad/build-daily-pool.ts` curates on. */
const MIN_DAILY_PAR = 14

/**
 * Strictly larger than the budget that set par: three times the restarts and
 * half again the clock. The point is "is there a cheaper factory", not "is this
 * budget better" — so there is no control arm here and no claim that this
 * budget should become the default.
 */
const HARDER = { ...DEFAULT_SEARCH_LIMITS, attemptsPerPlan: 1500, timeoutMs: 6000 }

interface Row {
  readonly id: string
  readonly day: number
  readonly par: number
  readonly found: number | null
  readonly improved: number
  readonly verified: boolean
  readonly belowFloorAfter: boolean
}

const levels = pool as unknown as Level[]
const rows: Row[] = []
const startedAt = Date.now()

for (let i = 0; i < levels.length; i += 1) {
  const level = levels[i]
  const day = i + 1
  const outcome = solve(level, day, HARDER)
  const cheapest = outcome.cheapest

  let found: number | null = null
  let verified = false
  if (cheapest !== null) {
    found = cheapest.cost
    // Never trust a cost the simulator has not confirmed.
    const result = simulate(level, cheapest.solution)
    verified = result.won && result.cost === cheapest.cost
  }

  const improved = found !== null && verified && found < level.par ? level.par - found : 0
  rows.push({
    id: level.id,
    day,
    par: level.par,
    found,
    improved,
    verified,
    belowFloorAfter: improved > 0 && level.par - improved < MIN_DAILY_PAR,
  })

  if (day % 25 === 0) {
    const beaten = rows.filter((r) => r.improved > 0).length
    console.log(`  ${day}/${levels.length} — ${beaten} beaten so far (${Math.round((Date.now() - startedAt) / 1000)}s)`)
  }
}

const beaten = rows.filter((r) => r.improved > 0)
const unsolved = rows.filter((r) => r.found === null)
const unverified = rows.filter((r) => r.found !== null && !r.verified)
const belowFloor = rows.filter((r) => r.belowFloorAfter)
const total = beaten.reduce((sum, r) => sum + r.improved, 0)

const summary = {
  levels: rows.length,
  solved: rows.length - unsolved.length,
  unsolvedByHarderSearch: unsolved.map((r) => r.id),
  unverifiedCosts: unverified.map((r) => r.id),
  parBeaten: beaten.length,
  parBeatenPct: Math.round((100 * beaten.length) / rows.length),
  meanSlackOverBeaten: beaten.length === 0 ? 0 : Number((total / beaten.length).toFixed(2)),
  meanSlackOverAll: Number((total / rows.length).toFixed(2)),
  worst: beaten
    .slice()
    .sort((a, b) => b.improved - a.improved)
    .slice(0, 10)
    .map((r) => `${r.id} day ${r.day}: par ${r.par} -> ${r.found} (${r.improved} under)`),
  slackHistogram: beaten.reduce<Record<number, number>>((h, r) => ({ ...h, [r.improved]: (h[r.improved] ?? 0) + 1 }), {}),
  // The reason this is a decision and not just a fix.
  wouldFallBelowDailyFloor: belowFloor.map((r) => `${r.id}: ${r.par} -> ${r.par - r.improved}`),
  seconds: Math.round((Date.now() - startedAt) / 1000),
}

console.log(JSON.stringify(summary, null, 2))
writeFileSync('artifacts/par-slack.json', JSON.stringify({ summary, rows }, null, 1))
console.log('\nwrote artifacts/par-slack.json')
