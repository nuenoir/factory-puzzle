/**
 * docs/generation-spec.md §4 stage C (plans) and §5 (materially different).
 *
 * Level 001 is the positive control the roadmap asks for: its two known
 * solutions must come out as two plans with different canonical forms. If they
 * ever collapse into one, criterion 4 stops measuring anything.
 */

import { describe, expect, it } from 'vitest'
import type { Level } from '@factory/sim'

import { COST, ROTATIONS, portsFor, simulate, type Placement, type PosTuple } from '@factory/sim'

import { canonicalPlan, enumeratePlans, machineCostOf, routeBelts, type Plan } from '../src/index'

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

describe('§4 the planner has no merger, on purpose', () => {
  /**
   * `PlanNodeKind` lists source, press, assembler, splitter and sink. No
   * merger — even though the palette offers one on roughly half the generated
   * levels and the simulator implements it fully (rules-spec §9, §14 cases 11
   * and 12). That looks like an oversight and is not one.
   *
   * A merger adds a building and removes none, so it can only earn its cost
   * through throughput. Throughput never binds here: the target is 5 items
   * against `max_ticks` of 300, and even one press at an item every two ticks
   * clears that with two orders of magnitude to spare. So every winning
   * solution containing a merger has a cheaper winning counterpart without it,
   * found by deleting the merger and one of its input chains.
   *
   * Planning mergers would therefore only add *dominated* plans, inflating
   * `distinctForms` with factories nobody would build — the same mistake the
   * renaming clause above exists to prevent, arriving from a different angle.
   *
   * This test builds the merger solution rather than arguing about it.
   */
  const twoSources = makeLevel({
    grid: { width: 5, height: 5 },
    sources: [
      { pos: [0, 1], rotation: 0, emits: 'ore' },
      { pos: [0, 3], rotation: 0, emits: 'ore' },
    ],
    sinks: [{ pos: [4, 2], rotation: 0 }],
    target: { type: 'ore', count: 5 },
    available: ['conveyor', 'merger'],
    recipes: {},
  })

  const key = (p: PosTuple) => `${p[0]},${p[1]}`
  const fixtures = new Set([...twoSources.sources, ...twoSources.sinks].map((b) => key(b.pos)))

  /** One source belted straight to the sink; the other simply unused. */
  function withoutMerger() {
    const belts = routeBelts(
      twoSources.grid,
      fixtures,
      { pos: twoSources.sources[0].pos, dir: portsFor('source', 0).out[0] },
      { pos: twoSources.sinks[0].pos, dir: portsFor('sink', 0).in[0] },
    )
    expect(belts).not.toBeNull()
    return simulate(twoSources, { level_id: twoSources.id, placements: belts as Placement[] })
  }

  /** Both sources joined through a merger, then on to the sink. */
  function withMerger() {
    for (let x = 1; x < 4; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        if (fixtures.has(key([x, y]))) continue
        for (const rotation of ROTATIONS) {
          const ports = portsFor('merger', rotation)
          const occupied = new Set(fixtures).add(key([x, y]))
          const belts: Placement[] = []

          const arms = twoSources.sources.every((source, i) => {
            const leg = routeBelts(twoSources.grid, occupied,
              { pos: source.pos, dir: portsFor('source', source.rotation).out[0] },
              { pos: [x, y], dir: ports.in[i] })
            if (leg === null) return false
            for (const b of leg) { occupied.add(key(b.pos)); belts.push(b) }
            return true
          })
          if (!arms) continue

          const out = routeBelts(twoSources.grid, occupied,
            { pos: [x, y], dir: ports.out[0] },
            { pos: twoSources.sinks[0].pos, dir: portsFor('sink', 0).in[0] })
          if (out === null) continue

          const result = simulate(twoSources, {
            level_id: twoSources.id,
            placements: [{ type: 'merger', pos: [x, y], rotation }, ...belts, ...out],
          })
          if (result.won) return result
        }
      }
    }
    return null
  }

  it('can be beaten by simply not using the merger', () => {
    const plain = withoutMerger()
    const merged = withMerger()

    // The merger layout is a real, winning factory — this is not a claim that
    // mergers are broken.
    expect(merged).not.toBeNull()
    expect(merged?.won).toBe(true)
    expect(plain.won).toBe(true)

    // ...and it is dominated on both axes the game scores.
    expect(merged?.cost).toBeGreaterThan(plain.cost)
    expect(merged?.ticks).toBeGreaterThanOrEqual(plain.ticks)
  })

  it('costs something and saves nothing, which is why it can never be par', () => {
    // The general argument in one line: a merger is a building you add, and
    // adding a building cannot lower a sum of building costs.
    expect(COST.merger).toBeGreaterThan(0)
  })

  it('never appears in a plan, so no verdict depends on the palette offering one', () => {
    const offered = makeLevel({
      available: ['conveyor', 'splitter', 'merger', 'press', 'assembler'],
      recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    })
    const withoutIt = makeLevel({
      available: ['conveyor', 'splitter', 'press', 'assembler'],
      recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    })
    expect(enumeratePlans(offered).map(canonicalPlan)).toEqual(enumeratePlans(withoutIt).map(canonicalPlan))
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

  describe('invariance under renaming item types', () => {
    /**
     * A mirror image is not a second idea. With two sources whose chains are
     * structurally identical, "press the left one" and "press the right one"
     * are the same factory — and an item-labelled form counted them twice,
     * which is the wigglier-belt failure §5 exists to prevent, one level up.
     */
    const mirrored = makeLevel({
      sources: [
        { pos: [0, 2], rotation: 0, emits: 'ore' },
        { pos: [0, 4], rotation: 0, emits: 'scrap' },
      ],
      available: ['conveyor', 'splitter', 'press', 'assembler'],
      // Both sources press into the same item, so every route has a twin.
      recipes: { press: { ore: 'plate', scrap: 'plate' }, assembler: [{ in: ['plate', 'plate'], out: 'widget' }] },
    })

    it('collapses two plans that differ only in which source they draw from', () => {
      const forms = new Set(enumeratePlans(mirrored).map(canonicalPlan))
      // Five plans, three ideas: press-then-split, two presses, split-then-press.
      expect(enumeratePlans(mirrored).length).toBe(5)
      expect(forms.size).toBe(3)
    })

    it('leaves level 001 alone', () => {
      // The guard against over-collapsing. Its two solutions use different
      // machines, so no renaming can conflate them.
      expect(new Set(enumeratePlans(level001).map(canonicalPlan)).size).toBe(2)
    })

    it('still separates a same-type pair from a two-type pair', () => {
      // The property most at risk. Renaming is a bijection, so `x + x` cannot
      // become `x + y` — if it ever could, criterion 4 would stop being able
      // to see the level-001 shape at all.
      const twoType = makeLevel({
        sources: [
          { pos: [0, 2], rotation: 0, emits: 'ore' },
          { pos: [0, 4], rotation: 0, emits: 'scrap' },
        ],
        available: ['conveyor', 'splitter', 'press', 'assembler'],
        recipes: { press: { ore: 'plate', scrap: 'rod' }, assembler: [{ in: ['plate', 'rod'], out: 'widget' }] },
      })
      expect(canonicalPlan(enumeratePlans(twoType)[0])).not.toBe(canonicalPlan(enumeratePlans(mirrored)[0]))
    })

    it('gives the same idea the same form across different levels', () => {
      // Press-then-split is press-then-split whether the item is a disc or a
      // plate. Falls out of the definition rather than being aimed at, but it
      // is what lets the catalogue be asked how many ideas it holds in total.
      const renamed = makeLevel({
        target: { type: 'gadget', count: 5 },
        available: ['conveyor', 'splitter', 'press', 'assembler'],
        recipes: { press: { circle: 'plate' }, assembler: [{ in: ['plate', 'plate'], out: 'gadget' }] },
      })
      expect(new Set(enumeratePlans(renamed).map(canonicalPlan)))
        .toEqual(new Set(enumeratePlans(level001).map(canonicalPlan)))
    })
  })

  it('counts machine cost as a sum, not a building count', () => {
    // CLAUDE.md's standing trap: cost is the §4 sum.
    const [shared] = enumeratePlans(level001)
    expect(machineCostOf(shared.nodes)).toBe(16)
    expect(shared.nodes.filter((n) => n.kind !== 'source' && n.kind !== 'sink')).toHaveLength(3)
  })
})
