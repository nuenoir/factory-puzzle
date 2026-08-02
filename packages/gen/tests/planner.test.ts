/**
 * docs/generation-spec.md §4 stage C (plans) and §5 (materially different).
 *
 * Level 001 is the positive control the roadmap asks for: its two known
 * solutions must come out as two plans with different canonical forms. If they
 * ever collapse into one, criterion 4 stops measuring anything.
 */

import { describe, expect, it } from 'vitest'
import type { Level } from '@factory/sim'

import { canonicalPlan, enumeratePlans, machineCostOf, type Plan } from '../src/index'

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'plan-test',
    grid: { width: 7, height: 7 },
    sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
    sinks: [{ pos: [6, 3], rotation: 0 }],
    target: { type: 'widget', count: 5 },
    max_ticks: 300,
    available: ['conveyor', 'splitter', 'merger', 'press', 'assembler'],
    recipes: {},
    par: 0,
    ...overrides,
  }
}

/** circle -> disc, disc + disc -> widget. */
const level001 = makeLevel({
  available: ['conveyor', 'splitter', 'press', 'assembler'],
  recipes: {
    press: { circle: 'disc' },
    assembler: [{ in: ['disc', 'disc'], out: 'widget' }],
  },
})

describe('enumeratePlans', () => {
  it('finds no plan when the chemistry cannot reach the target', () => {
    expect(enumeratePlans(makeLevel({ recipes: { press: { circle: 'disc' } } }))).toEqual([])
  })

  it('delivers a source item straight to the sink with no machines', () => {
    const plans = enumeratePlans(makeLevel({ target: { type: 'circle', count: 5 } }))
    expect(plans).toHaveLength(1)
    expect(plans[0].machineCost).toBe(0)
    expect(plans[0].nodes.map((n) => n.kind)).toEqual(['source', 'sink'])
  })

  it('finds exactly the two known level-001 solutions', () => {
    const plans = enumeratePlans(level001)
    expect(plans).toHaveLength(2)

    const kinds = plans.map((p) =>
      p.nodes
        .filter((n) => n.kind !== 'source' && n.kind !== 'sink')
        .map((n) => n.kind)
        .sort()
        .join('+'),
    )
    expect(kinds).toContain('assembler+press+splitter')
    // Split-then-press needs its own splitter: one source cannot feed two
    // presses unaided, which is the whole reason that route costs more.
    expect(kinds).toContain('assembler+press+press+splitter')
  })

  it('prices the two routes exactly as docs/level-001.md does', () => {
    const plans = enumeratePlans(level001)
    // Press then split: press(5) + splitter(3) = 8, plus assembler(8) = 16.
    // Split then press: splitter(3) + press(5) + press(5) = 13, plus 8 = 21.
    expect(plans[0].machineCost).toBe(16)
    expect(plans[1].machineCost).toBe(21)
    expect(plans[0].machineCost).toBeLessThan(plans[1].machineCost)
  })

  it('finds nothing at all when a lone source has no splitter to fan out with', () => {
    // A source has one output port. Without a splitter, no arrangement can put
    // two discs into an assembler, so the level is genuinely unsolvable.
    const noSplitter = makeLevel({
      available: ['conveyor', 'press', 'assembler'],
      recipes: level001.recipes,
    })
    expect(enumeratePlans(noSplitter)).toEqual([])
  })

  it('skips the extra splitter when a second source already supplies the fan-out', () => {
    const twoSources = makeLevel({
      sources: [
        { pos: [0, 2], rotation: 0, emits: 'circle' },
        { pos: [0, 4], rotation: 0, emits: 'circle' },
      ],
      available: ['conveyor', 'press', 'assembler'],
      recipes: level001.recipes,
    })
    const plans = enumeratePlans(twoSources)
    // One press per source, straight into the assembler: 5 + 5 + 8.
    expect(plans.some((p) => p.machineCost === 18)).toBe(true)
    expect(plans.every((p) => p.nodes.every((n) => n.kind !== 'splitter'))).toBe(true)
  })

  it('feeds both assembler ports from the one splitter node', () => {
    const shared = enumeratePlans(level001)[0]
    const assembler = shared.nodes.find((n) => n.kind === 'assembler')
    expect(assembler?.inputs).toHaveLength(2)
    // The same node id twice: one splitter supplying both ports over time.
    expect(assembler?.inputs[0]).toBe(assembler?.inputs[1])
  })

  it('terminates on a recipe cycle', () => {
    const cyclic = makeLevel({
      target: { type: 'gadget', count: 1 },
      recipes: { press: { circle: 'disc', disc: 'circle' } },
    })
    expect(enumeratePlans(cyclic)).toEqual([])
  })

  it('respects the plan cap', () => {
    expect(enumeratePlans(level001, { maxDepth: 4, maxPlans: 1 })).toHaveLength(1)
  })
})

describe('§5 canonical form', () => {
  it('separates the two level-001 solutions', () => {
    const [shared, twoPresses] = enumeratePlans(level001)
    expect(canonicalPlan(shared)).not.toBe(canonicalPlan(twoPresses))
  })

  it('ignores node numbering, so the same idea canonicalises identically', () => {
    const plan = enumeratePlans(level001)[0]
    const renumbered = {
      ...plan,
      // Reverse the id space; the graph is unchanged, only the labels move.
      nodes: plan.nodes.map((n) => ({
        ...n,
        id: plan.nodes.length - 1 - n.id,
        inputs: n.inputs.map((i) => plan.nodes.length - 1 - i),
      })),
    }
    expect(canonicalPlan(renumbered)).toBe(canonicalPlan(plan))
  })

  it('separates plans that use the same machines but wire them differently', () => {
    // §5 is a multiset *and* a flow graph. Two presses in series is not the
    // same factory as two presses in parallel, and a canonical form that
    // looked only at the machine counts would call them identical.
    const series: Plan = {
      machineCost: 10,
      nodes: [
        { id: 0, kind: 'source', item: 'a', inputs: [], sourceIndex: 0 },
        { id: 1, kind: 'press', item: 'b', inputs: [0] },
        { id: 2, kind: 'press', item: 'c', inputs: [1] },
        { id: 3, kind: 'sink', item: 'c', inputs: [2] },
      ],
    }
    const parallel: Plan = {
      machineCost: 10,
      nodes: [
        { id: 0, kind: 'source', item: 'a', inputs: [], sourceIndex: 0 },
        { id: 1, kind: 'press', item: 'b', inputs: [0] },
        { id: 2, kind: 'press', item: 'b', inputs: [0] },
        { id: 3, kind: 'sink', item: 'b', inputs: [1, 2] },
      ],
    }

    expect(machineCostOf(series.nodes)).toBe(machineCostOf(parallel.nodes))
    expect(canonicalPlan(series)).not.toBe(canonicalPlan(parallel))
  })

  it('counts machine cost as a sum, not a building count', () => {
    // CLAUDE.md's standing trap: cost is the §4 sum.
    const [shared] = enumeratePlans(level001)
    expect(machineCostOf(shared.nodes)).toBe(16)
    expect(shared.nodes.filter((n) => n.kind !== 'source' && n.kind !== 'sink')).toHaveLength(3)
  })
})
