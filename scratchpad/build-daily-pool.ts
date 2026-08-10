/**
 * Build levels/daily.json — the rotation pool the app plays from.
 *
 *   node --experimental-strip-types scratchpad/build-daily-pool.ts
 *
 * Runs the batch, keeps what the validator accepted, curates, and writes the
 * levels in play order. Reproducible from the seed alone, so the pool is
 * regenerable rather than a blob somebody has to trust.
 *
 * **Curation is not validation.** The validator answers "is this a valid
 * puzzle" and its verdicts are published in docs/writeup.md; nothing here may
 * change them. This file answers a different question — "is this a good
 * Tuesday" — and it answers it by dropping levels, never by loosening a
 * criterion. Raising `min_cost` would have re-scored the published batch.
 */

import { writeFileSync } from 'node:fs'

import {
  runBatch,
  DEFAULT_CRITERIA,
  DEFAULT_GENERATOR_OPTIONS,
  DEFAULT_SEARCH_LIMITS,
} from '../packages/gen/src/index.ts'
import type { Level } from '@factory/sim'

const COUNT = 1000
const SEED = 1

/**
 * Below this par a puzzle is a formality rather than a day's puzzle — one
 * press and a belt run, with "one press or two" as the only decision.
 *
 * Not an arbitrary line. The accepted pool's par histogram has a clean gap
 * between 10 and 18, so anywhere in between removes exactly the same fourteen
 * levels; 14 sits in the gap and will keep meaning the same thing if the
 * distribution shifts slightly. Those levels remain accepted by the validator
 * and remain in the rejection log's counts. They are simply not dealt out.
 */
const MIN_DAILY_PAR = 14

/** The generator's PRNG, reused so the shuffle is seeded like everything else. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

process.stdout.write(`Generating ${COUNT} candidates from seed ${SEED}...\n`)

const { accepted } = runBatch({
  count: COUNT,
  startSeed: SEED,
  criteria: DEFAULT_CRITERIA,
  generator: DEFAULT_GENERATOR_OPTIONS,
  limits: DEFAULT_SEARCH_LIMITS,
})

const playable = accepted.filter((level) => level.par >= MIN_DAILY_PAR)

// Deal them out shuffled rather than in seed order. Consecutive seeds share
// generator state and so tend to share shape and size; unshuffled, a player
// would get a run of near-identical puzzles and conclude the game has one idea
// in it — which is exactly the criticism the generator work just answered.
const SHUFFLE_SEED = 20260810 // the launch date, so the order has a reason to be this one
const random = mulberry32(SHUFFLE_SEED)
const order: Level[] = [...playable]
for (let i = order.length - 1; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1))
  ;[order[i], order[j]] = [order[j], order[i]]
}

writeFileSync('levels/daily.json', `${JSON.stringify(order, null, 0)}\n`)

const pars = order.map((l) => l.par).sort((a, b) => a - b)
const median = pars[Math.floor(pars.length / 2)]
process.stdout.write(`
  accepted        ${accepted.length} / ${COUNT}
  dropped as thin ${accepted.length - playable.length}  (par < ${MIN_DAILY_PAR})
  pool            ${order.length} levels  =  ${(order.length / 30.44).toFixed(1)} months of dailies
  par             ${pars[0]}-${pars[pars.length - 1]}, median ${median}

  written to levels/daily.json
`)
