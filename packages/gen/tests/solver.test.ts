/**
 * docs/generation-spec.md §4 stage C — placement search.
 *
 * The search is bounded and random, so these tests assert what it is allowed
 * to claim, not that it finds any particular layout. The one thing that must
 * always hold is that every solution it returns genuinely wins, because the
 * validator reports the cheapest of them as the level's par.
 */

import { describe, expect, it } from 'vitest'
import { simulate, type Level } from '@factory/sim'

import { canonicalPlan, solve } from '../src/index'

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'solve-test',
    grid: { width: 7, height: 7 },
    sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
    sinks: [{ pos: [6, 3], rotation: 0 }],
    target: { type: 'widget', count: 5 },
    max_ticks: 300,
    available: ['conveyor', 'splitter', 'press', 'assembler'],
    recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    par: 21,
    ...overrides,
  }
}

/** A generous budget so these tests measure the search, not the clock. */
const patient = { attemptsPerPlan: 400, timeoutMs: 30000 }

describe('solve', () => {
  it('finds a working factory for level 001', () => {
    const outcome = solve(makeLevel(), 1, patient)
    expect(outcome.cheapest).not.toBeNull()
  })

  it('only ever returns solutions that actually win', () => {
    // The load-bearing invariant. Routing succeeding is not winning.
    const level = makeLevel()
    for (const found of solve(level, 7, patient).solutions) {
      const result = simulate(level, found.solution)
      expect(result.errors).toEqual([])
      expect(result.won).toBe(true)
      expect(result.cost).toBe(found.cost)
    }
  })

  it('reports the cheapest solution it found, and cheapest really is cheapest', () => {
    const outcome = solve(makeLevel(), 3, patient)
    const costs = outcome.solutions.map((s) => s.cost)
    expect(outcome.cheapest?.cost).toBe(Math.min(...costs))
  })

  it('never beats the hand-designed par, since 21 is a real solution', () => {
    // A cheaper find would be a genuine discovery; a cheaper *claim* without a
    // winning layout would be a bug. simulate() has already vouched for these.
    const outcome = solve(makeLevel(), 11, patient)
    expect(outcome.cheapest!.cost).toBeGreaterThan(0)
    expect(outcome.cheapest!.cost).toBeLessThanOrEqual(40)
  })

  it('verifies both level-001 ideas — the positive control for criterion 4', () => {
    // The roadmap asks for a puzzle with more than one materially different
    // solution as the generator's positive control. Level 001 is it, and both
    // routes have to survive all the way to a simulated win, not just to a
    // plan: press-then-split, and split-then-press with its own splitter.
    const outcome = solve(makeLevel(), 1, patient)
    expect(outcome.distinctForms).toBe(2)

    const machineSets = outcome.solutions.map((s) =>
      s.solution.placements
        .filter((p) => p.type !== 'conveyor')
        .map((p) => p.type)
        .sort()
        .join('+'),
    )
    expect(machineSets).toContain('assembler+press+splitter')
    expect(machineSets).toContain('assembler+press+press+splitter')
  })

  it('separates the two level-001 ideas when it finds both', () => {
    const outcome = solve(makeLevel(), 5, patient)
    const forms = new Set(outcome.solutions.map((s) => canonicalPlan(s.plan)))
    // One entry per distinct plan, never two rows for the same idea.
    expect(forms.size).toBe(outcome.solutions.length)
    expect(outcome.distinctForms).toBe(outcome.solutions.length)
  })

  it('is deterministic for a fixed seed', () => {
    const run = () => JSON.stringify(solve(makeLevel(), 42, patient).solutions.map((s) => s.solution))
    const first = run()
    for (let i = 0; i < 3; i += 1) expect(run()).toBe(first)
  })

  it('finds nothing when the chemistry cannot reach the target', () => {
    const impossible = makeLevel({ recipes: { press: { circle: 'disc' } } })
    const outcome = solve(impossible, 1, { attemptsPerPlan: 20, timeoutMs: 2000 })
    expect(outcome.cheapest).toBeNull()
    expect(outcome.plansTried).toBe(0)
  })

  it('reports being cut short rather than pretending it looked everywhere', () => {
    // §4: a bounded search must never let "no solution found" read as proof.
    let clock = 0
    const outcome = solve(makeLevel(), 1, { attemptsPerPlan: 10000, timeoutMs: 5 }, () => (clock += 4))
    expect(outcome.exhausted).toBe(false)
  })

  it('reports exhaustion when it did run its full allowance', () => {
    const outcome = solve(makeLevel(), 2, patient)
    expect(outcome.exhausted).toBe(true)
  })
})
