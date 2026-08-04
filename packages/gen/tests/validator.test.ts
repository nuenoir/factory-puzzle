/**
 * docs/generation-spec.md §3 (criteria), §4 (claim strength), §6 (the log).
 *
 * The claim-strength tests are the important ones. A rejection from stage A or
 * B is a proof; one from stage C only means the bounded search came up empty.
 * If those ever share a code or a stage label, the write-up starts asserting
 * things the validator cannot actually know.
 */

import { describe, expect, it } from 'vitest'
import type { Level } from '@factory/sim'

import {
  ALL_REJECTION_CODES,
  DEFAULT_SEARCH_LIMITS,
  generateLevel,
  runBatch,
  summarise,
  toJsonl,
  validate,
  withComputedPar,
} from '../src/index'

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'validate-test',
    grid: { width: 7, height: 7 },
    sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
    sinks: [{ pos: [6, 3], rotation: 0 }],
    target: { type: 'widget', count: 5 },
    max_ticks: 300,
    available: ['conveyor', 'splitter', 'press', 'assembler'],
    recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    par: 0,
    ...overrides,
  }
}

const patient = { ...DEFAULT_SEARCH_LIMITS, attemptsPerPlan: 400, timeoutMs: 30000 }

describe('§3 acceptance criteria', () => {
  it('accepts level 001, which has two materially different solutions', () => {
    const verdict = validate(makeLevel(), 1, { minCost: 8, maxCost: 30 }, patient)
    expect(verdict.accepted).toBe(true)
    expect(verdict.reason).toBeNull()
    expect(verdict.distinctForms).toBeGreaterThanOrEqual(2)
  })

  it('computes par rather than trusting the proposed one', () => {
    // §2: the generator never proposes par. It arrives as 0 and is replaced by
    // the cost of the cheapest solution actually verified.
    const level = makeLevel({ par: 999 })
    const verdict = validate(level, 1, { minCost: 8, maxCost: 30 }, patient)
    expect(verdict.par).toBe(verdict.cheapestCost)
    expect(withComputedPar(level, verdict).par).toBe(verdict.cheapestCost)
    expect(withComputedPar(level, verdict).par).not.toBe(999)
  })

  it('rejects a level whose cheapest solution costs more than the budget', () => {
    // The budget has to clear the stage-B floor of 13, or the cheap proof
    // fires first and stage C never runs. Real solutions here cost ~21+.
    const verdict = validate(makeLevel(), 1, { minCost: 8, maxCost: 15 }, patient)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe('over_budget')
    expect(verdict.stage).toBe('C')
    expect(verdict.cheapestCost).toBeGreaterThan(15)
  })

  it('prefers the cheap proof when the budget is below the floor', () => {
    // Same level, tighter budget: stage B settles it without any search, and
    // the reason says so. Ordering the checks cheapest-first is what makes a
    // 50-candidate batch affordable.
    const verdict = validate(makeLevel(), 1, { minCost: 8, maxCost: 12 }, patient)
    expect(verdict.reason).toBe('over_budget_floor')
    expect(verdict.stage).toBe('B')
  })

  it('rejects a pure routing exercise as trivial', () => {
    // Deliver the source item itself: a belt run and nothing else.
    const belts = makeLevel({ target: { type: 'circle', count: 5 }, recipes: {} })
    const verdict = validate(belts, 1, { minCost: 8, maxCost: 30 }, patient)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe('trivial')
  })

  it('rejects a level with only one materially different solution', () => {
    // Two sources, no splitter: one press per source is the only idea there is.
    const single = makeLevel({
      sources: [
        { pos: [0, 2], rotation: 0, emits: 'circle' },
        { pos: [0, 4], rotation: 0, emits: 'circle' },
      ],
      available: ['conveyor', 'press', 'assembler'],
    })
    const verdict = validate(single, 1, { minCost: 8, maxCost: 30 }, patient)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe('single_solution')
    expect(verdict.distinctForms).toBe(1)
  })
})

describe('§4 what a rejection is allowed to claim', () => {
  it('proves unsolvability at stage A without any search', () => {
    const orphan = makeLevel({ recipes: { press: { circle: 'disc' } } })
    const verdict = validate(orphan, 1, { minCost: 8, maxCost: 30 }, patient)
    expect(verdict.reason).toBe('unsolvable_chemistry')
    expect(verdict.stage).toBe('A')
    // Nothing was searched, so nothing was spent.
    expect(verdict.bound.attempts).toBe(0)
  })

  it('proves the budget is unreachable at stage B without any search', () => {
    const verdict = validate(makeLevel(), 1, { minCost: 0, maxCost: 5 }, patient)
    expect(verdict.reason).toBe('over_budget_floor')
    expect(verdict.stage).toBe('B')
    expect(verdict.bound.attempts).toBe(0)
    // The floor is a lower bound, so exceeding the budget really is a proof.
    expect(verdict.floorCost).toBe(13)
  })

  it('never labels a bounded search as a proof', () => {
    let clock = 0
    const verdict = validate(makeLevel(), 1, { minCost: 8, maxCost: 30 }, { ...patient, attemptsPerPlan: 9999, timeoutMs: 5 }, () => (clock += 4))
    expect(verdict.stage).toBe('C')
    expect(verdict.bound.exhausted).toBe(false)
    expect(verdict.reason).not.toBe('unsolvable_chemistry')
  })

  it('proves a missing splitter makes a same-type pair impossible', () => {
    // Level 001's chemistry with the splitter taken away. One source, two
    // assembler ports wanting the same item, and nothing in the palette that
    // fans out. Stage A still says `widget` is reachable — the closure only
    // tracks types — so without stage B this fell through to a bounded search
    // that spent its whole allowance proving nothing.
    const noSplitter = makeLevel({ available: ['conveyor', 'press', 'assembler'] })
    const verdict = validate(noSplitter, 1, { minCost: 8, maxCost: 30 }, patient)
    expect(verdict.reason).toBe('insufficient_fanout')
    expect(verdict.stage).toBe('B')
    // Proven means nothing was searched.
    expect(verdict.bound.attempts).toBe(0)
    expect(verdict.bound.plansTried).toBe(0)
  })

  it('does not fire the fan-out proof when a splitter is available', () => {
    expect(validate(makeLevel(), 1, { minCost: 8, maxCost: 30 }, patient).reason).not.toBe('insufficient_fanout')
  })

  it('does not fire the fan-out proof when two sources supply the pair', () => {
    // The false-positive guard. A proven code that fires on a solvable level
    // would be the worst bug in this package.
    const twoSources = makeLevel({
      sources: [
        { pos: [0, 2], rotation: 0, emits: 'circle' },
        { pos: [0, 4], rotation: 0, emits: 'circle' },
      ],
      available: ['conveyor', 'press', 'assembler'],
    })
    expect(validate(twoSources, 1, { minCost: 8, maxCost: 30 }, patient).reason).not.toBe('insufficient_fanout')
  })

  it('separates a plan-bounded miss from a placement-bounded one', () => {
    // Two different bounds, two different codes, two different fixes. Starving
    // the plan enumerator of depth means nothing was ever placed...
    const starved = validate(makeLevel(), 1, { minCost: 8, maxCost: 30 }, { ...patient, maxDepth: 1 })
    expect(starved.reason).toBe('no_plan_within_depth')
    expect(starved.stage).toBe('C')
    expect(starved.bound.plansTried).toBe(0)
    expect(starved.bound.attempts).toBe(0)
    expect(starved.bound.maxDepth).toBe(1)

    // ...whereas starving the placement search means plans existed and every
    // layout of them failed. The tally is what tells them apart.
    const cramped = makeLevel({ grid: { width: 3, height: 3 }, sinks: [{ pos: [2, 1], rotation: 0 }] })
    const stuck = validate(cramped, 1, { minCost: 8, maxCost: 30 }, { ...patient, attemptsPerPlan: 30 })
    expect(stuck.reason).toBe('no_placement_found')
    expect(stuck.bound.plansTried).toBeGreaterThan(0)
    expect(stuck.bound.attempts).toBeGreaterThan(0)
  })

  it('records every cap the search was subject to', () => {
    // §4 — all four bounds logged, or a bounded verdict cannot be argued with.
    const verdict = validate(makeLevel(), 1, { minCost: 8, maxCost: 30 }, patient)
    expect(verdict.bound.maxDepth).toBe(patient.maxDepth)
    expect(verdict.bound.maxPlans).toBe(patient.maxPlans)
    expect(verdict.bound.attemptsPerPlan).toBe(400)
    expect(verdict.bound.timeoutMs).toBe(30000)
  })
})

describe('§6 the rejection log', () => {
  it('marks only stage A and B reasons as proven', () => {
    const summary = summarise([
      { reason: 'unsolvable_chemistry', accepted: false, stage: 'A', bound: { exhausted: true } },
      { reason: 'over_budget_floor', accepted: false, stage: 'B', bound: { exhausted: true } },
      { reason: 'insufficient_fanout', accepted: false, stage: 'B', bound: { exhausted: true } },
      { reason: 'no_plan_within_depth', accepted: false, stage: 'C', bound: { exhausted: true } },
      { reason: 'no_placement_found', accepted: false, stage: 'C', bound: { exhausted: true } },
      { reason: null, accepted: true, stage: 'C', bound: { exhausted: true } },
    ] as never)

    const proven = Object.fromEntries(summary.rejections.map((r) => [r.reason, r.proven]))
    expect(proven['unsolvable_chemistry']).toBe(true)
    expect(proven['over_budget_floor']).toBe(true)
    expect(proven['insufficient_fanout']).toBe(true)
    // Both stage-C codes are bounded, by different bounds. Neither is a proof.
    expect(proven['no_plan_within_depth']).toBe(false)
    expect(proven['no_placement_found']).toBe(false)
    expect(summary.accepted).toBe(1)
    expect(summary.total).toBe(6)
  })

  it('labels every code it can emit, so none can silently default to bounded', () => {
    // A new proven code that nobody added to the PROVEN set would be reported
    // as bounded and quietly understate the validator. Fail loudly instead.
    const summary = summarise(
      ALL_REJECTION_CODES.map((reason) => ({ reason, accepted: false, stage: 'C', bound: { exhausted: true } })) as never,
    )
    expect(summary.rejections).toHaveLength(ALL_REJECTION_CODES.length)
    const provenCount = summary.rejections.filter((r) => r.proven).length
    expect(provenCount).toBe(3)
  })

  it('counts searches that were cut short', () => {
    const summary = summarise([
      { reason: 'no_placement_found', accepted: false, stage: 'C', bound: { exhausted: false } },
      { reason: 'no_placement_found', accepted: false, stage: 'C', bound: { exhausted: true } },
    ] as never)
    expect(summary.cutShort).toBe(1)
  })

  it('writes one self-contained JSON object per line', () => {
    const { records } = runBatch(
      { count: 3, startSeed: 1, criteria: { minCost: 8, maxCost: 30 }, limits: { ...patient, attemptsPerPlan: 5, timeoutMs: 500 }, generator: { minGrid: 5, maxGrid: 5 } },
    )
    const lines = toJsonl(records).trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      const parsed = JSON.parse(line)
      expect(parsed).toHaveProperty('seed')
      expect(parsed).toHaveProperty('accepted')
      expect(parsed).toHaveProperty('stage')
      expect(parsed).toHaveProperty('bound')
    }
  })
})

describe('§7 reproducibility', () => {
  it('generates the same level from the same seed', () => {
    expect(JSON.stringify(generateLevel(42))).toBe(JSON.stringify(generateLevel(42)))
    expect(JSON.stringify(generateLevel(42))).not.toBe(JSON.stringify(generateLevel(43)))
  })

  it('never proposes a par — that is the validator’s job', () => {
    for (let seed = 1; seed <= 20; seed += 1) expect(generateLevel(seed).par).toBe(0)
  })

  it('reproduces a whole batch apart from the clock', () => {
    const options = {
      count: 4,
      startSeed: 100,
      criteria: { minCost: 8, maxCost: 30 },
      limits: { ...patient, attemptsPerPlan: 20, timeoutMs: 2000 },
      generator: { minGrid: 5, maxGrid: 6 },
    }
    const strip = (json: string) => json.replace(/"elapsed_ms":\d+/g, '"elapsed_ms":0')
    const first = strip(JSON.stringify(runBatch(options).records))
    expect(strip(JSON.stringify(runBatch(options).records))).toBe(first)
  })
})
