/**
 * The twelve cases from docs/rules-spec.md §14.
 *
 * These are the definition of a correct simulator. Per CLAUDE.md, if one of
 * these needs changing to accommodate a code change, stop — that usually means
 * the code is wrong, not the test.
 */

import { describe, expect, it } from 'vitest'

import {
  conservationHolds,
  clearItems,
  itemsInWorld,
  seedItems,
  simulate,
  snapshot,
  step,
  type PosTuple,
  type Rotation,
} from '../src/index.js'
import { beltRun, belt, buildWorld, cellAt, itemsOn, machine, makeLevel, solutionOf } from './helpers.js'

describe('§14.1 straight line', () => {
  it('delivers the first item on tick 4', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      sinks: [{ pos: [4, 3], rotation: 0 }],
      target: { type: 'circle', count: 5 },
    })
    const world = buildWorld(level, beltRun(1, 3, 3))

    for (let i = 0; i < 3; i += 1) {
      step(world)
      expect(snapshot(world).delivered['circle'] ?? 0).toBe(0)
    }
    step(world)
    expect(world.tickCount).toBe(4)
    expect(snapshot(world).delivered['circle']).toBe(1)
  })
})

describe('§14.2 train movement', () => {
  it('advances all five items in the same tick', () => {
    const level = makeLevel()
    const world = buildWorld(level, beltRun(0, 0, 6))
    const cells: PosTuple[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]

    seedItems(
      world,
      cells.slice(0, 5).map((pos, i) => ({ pos, item: `item${i}` })),
    )
    step(world)

    // Every item moved exactly one cell, in one tick — not one item per tick.
    expect(cellAt(world, [0, 0]).item).toBeNull()
    for (let i = 0; i < 5; i += 1) {
      expect(cellAt(world, cells[i + 1]).item).toBe(`item${i}`)
    }
  })
})

describe('§14.3 back-pressure', () => {
  it('stacks items back to the source and destroys nothing', () => {
    const level = makeLevel({ sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }] })
    const world = buildWorld(level, beltRun(1, 3, 3))

    for (let i = 0; i < 20; i += 1) step(world)

    // Three belt cells, three items, and the source gave up after filling them.
    expect(itemsOn(world, [
      [1, 3],
      [2, 3],
      [3, 3],
    ])).toBe(3)
    expect(itemsInWorld(world)).toBe(3)
    expect(world.ledger.emitted).toBe(3)
    expect(conservationHolds(world)).toBe(true)
  })
})

/** Shared fixture for the splitter cases: a rotation-0 splitter at (2,3). */
function splitterWorld(includeEastBranch: boolean, northLength: number) {
  const level = makeLevel({ sources: [{ pos: [0, 3], rotation: 0, emits: 'x' }] })
  const northAll: PosTuple[] = [
    [2, 2],
    [2, 1],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]
  const north = northAll.slice(0, northLength)

  const placements = [
    belt(1, 3, 'W', 'E'),
    machine('splitter', 2, 3, 0),
    // Up the column, then east along the top row.
    belt(2, 2, 'S', 'N'),
    belt(2, 1, 'S', 'N'),
    belt(2, 0, 'S', 'E'),
    ...beltRun(3, 0, northLength - 3),
  ]
  const east: PosTuple[] = [
    [3, 3],
    [4, 3],
    [5, 3],
    [6, 3],
  ]
  if (includeEastBranch) placements.push(...beltRun(3, 3, 4))

  return { world: buildWorld(level, placements), north, east }
}

describe('§14.4 splitter alternation', () => {
  it('pushes N, E, N, E, N, E with both branches open', () => {
    const { world, north, east } = splitterWorld(true, 4)
    const order: string[] = []
    let seenNorth = 0
    let seenEast = 0

    for (let i = 0; i < 30 && order.length < 6; i += 1) {
      step(world)
      const n = itemsOn(world, north)
      const e = itemsOn(world, east)
      if (n > seenNorth) order.push('N')
      if (e > seenEast) order.push('E')
      seenNorth = n
      seenEast = e
    }

    expect(order).toEqual(['N', 'E', 'N', 'E', 'N', 'E'])
    expect(seenNorth).toBe(3)
    expect(seenEast).toBe(3)
  })
})

describe('§14.5 splitter with one output blocked', () => {
  it('sends all six items down the open branch and leaves next back at 0', () => {
    const { world, north } = splitterWorld(false, 6)

    for (let i = 0; i < 40; i += 1) step(world)

    expect(itemsOn(world, north)).toBe(6)
    // next flips on every successful push, including fallback successes:
    // six pushes is six flips, so it lands back on index 0.
    expect(cellAt(world, [2, 3]).next).toBe(0)
    expect(conservationHolds(world)).toBe(true)
  })
})

describe('§14.6 machine stall', () => {
  it('holds its product, backs up, and resumes without losing anything', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      recipes: { press: { circle: 'disc' } },
    })
    // The press pushes east onto a dead-end belt, which fills and never drains.
    const world = buildWorld(level, [belt(1, 3, 'W', 'E'), machine('press', 2, 3, 0), belt(3, 3, 'W', 'E')])

    for (let i = 0; i < 20; i += 1) step(world)

    const press = cellAt(world, [2, 3])
    expect(cellAt(world, [3, 3]).item).toBe('disc')
    expect(press.output).toBe('disc') // product held, output blocked
    expect(press.job).not.toBeNull()
    expect(press.job?.timer).toBe(0) // finished-but-held, and not drifting negative
    expect(press.inputs.get('W')).toBe('circle') // input backed up behind the stall

    clearItems(world, [[3, 3]])
    step(world)

    expect(cellAt(world, [3, 3]).item).toBe('disc') // pushed the held product
    expect(press.output).toBe('disc') // and immediately placed the held job's
    expect(press.job).not.toBeNull() // and started the next one
    expect(conservationHolds(world)).toBe(true) // nothing lost across the stall
  })

  it('reports a permanent stall as jammed', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      recipes: { press: { circle: 'disc' } },
      target: { type: 'disc', count: 1 },
    })
    const result = simulate(
      level,
      solutionOf(level, [belt(1, 3, 'W', 'E'), machine('press', 2, 3, 0), belt(3, 3, 'W', 'E')]),
    )

    expect(result.won).toBe(false)
    expect(result.jammed).toBe(true)
    expect(result.ticks).toBe(level.max_ticks)
  })
})

describe('§14.7 assembler deadlock', () => {
  it('deadlocks permanently on two items that form no recipe pair', () => {
    const level = makeLevel({
      sources: [
        { pos: [0, 3], rotation: 0, emits: 'disc' },
        { pos: [1, 2], rotation: 90, emits: 'disc' },
      ],
      recipes: { assembler: [{ in: ['disc', 'plate'], out: 'widget' }] },
      target: { type: 'widget', count: 1 },
    })
    const result = simulate(level, solutionOf(level, [machine('assembler', 1, 3, 0)]))

    expect(result.won).toBe(false)
    expect(result.jammed).toBe(true)
    expect(result.ticks).toBe(level.max_ticks)
    expect(result.errors).toEqual([])
  })

  it('never pulls in an item that appears in no recipe — it jams on the belt', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'rock' }],
      recipes: { assembler: [{ in: ['disc', 'plate'], out: 'widget' }] },
    })
    const world = buildWorld(level, [belt(1, 3, 'W', 'E'), machine('assembler', 2, 3, 0)])

    for (let i = 0; i < 10; i += 1) step(world)

    const assembler = cellAt(world, [2, 3])
    expect(assembler.inputs.get('W')).toBeNull()
    expect(assembler.inputs.get('N')).toBeNull()
    expect(cellAt(world, [1, 3]).item).toBe('rock')
    expect(conservationHolds(world)).toBe(true)
  })
})

describe('§14.8 determinism', () => {
  it('produces a byte-identical result across 100 runs', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      sinks: [{ pos: [6, 3], rotation: 0 }],
      recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    })
    const solution = solutionOf(level, [
      belt(1, 3, 'W', 'E'),
      machine('press', 2, 3, 0),
      machine('splitter', 3, 3, 0),
      belt(4, 3, 'W', 'E'),
      belt(3, 2, 'S', 'E'),
      belt(4, 2, 'W', 'E'),
      belt(5, 2, 'W', 'S'),
      machine('assembler', 5, 3, 0),
    ])

    const first = JSON.stringify(simulate(level, solution))
    for (let i = 0; i < 99; i += 1) {
      expect(JSON.stringify(simulate(level, solution))).toBe(first)
    }
  })
})

describe('§14.9 cyclic belt', () => {
  const loop: PosTuple[] = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
  ]
  const loopBelts = [belt(1, 1, 'S', 'E'), belt(2, 1, 'W', 'S'), belt(2, 2, 'N', 'W'), belt(1, 2, 'E', 'N')]

  it('rotates one cell per tick when a gap exists', () => {
    const world = buildWorld(makeLevel(), loopBelts)
    seedItems(world, [
      { pos: [1, 1], item: 'a' },
      { pos: [2, 1], item: 'b' },
      { pos: [2, 2], item: 'c' },
    ])

    step(world)

    expect(cellAt(world, [1, 1]).item).toBeNull()
    expect(cellAt(world, [2, 1]).item).toBe('a')
    expect(cellAt(world, [2, 2]).item).toBe('b')
    expect(cellAt(world, [1, 2]).item).toBe('c')
  })

  it('does not move when saturated, and does not crash', () => {
    const world = buildWorld(makeLevel(), loopBelts)
    seedItems(world, loop.map((pos, i) => ({ pos, item: `item${i}` })))
    const before = JSON.stringify(snapshot(world).buildings)

    step(world)
    step(world)

    expect(JSON.stringify(snapshot(world).buildings)).toBe(before)
    expect(conservationHolds(world)).toBe(true)
  })
})

describe('§14.10 loss conservation', () => {
  it('holds every tick while a full factory runs', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      sinks: [{ pos: [6, 3], rotation: 0 }],
      recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    })
    const world = buildWorld(level, [
      belt(1, 3, 'W', 'E'),
      machine('press', 2, 3, 0),
      machine('splitter', 3, 3, 0),
      belt(4, 3, 'W', 'E'),
      belt(3, 2, 'S', 'E'),
      belt(4, 2, 'W', 'E'),
      belt(5, 2, 'W', 'S'),
      machine('assembler', 5, 3, 0),
    ])

    // tick() asserts the invariant internally; this checks it independently too.
    for (let i = 0; i < 60; i += 1) {
      step(world)
      expect(conservationHolds(world)).toBe(true)
    }
  })
})

/** Shared fixture for the merger cases: a rotation-0 merger at (2,2). */
function mergerWorld(feedNorth: boolean) {
  const sources: Array<{ pos: PosTuple; rotation: Rotation; emits: string }> = [
    { pos: [0, 2], rotation: 0, emits: 'a' },
  ]
  const placements = [belt(1, 2, 'W', 'E'), machine('merger', 2, 2, 0), belt(3, 2, 'W', 'E')]

  if (feedNorth) {
    sources.push({ pos: [2, 0], rotation: 90, emits: 'b' })
    placements.push(belt(2, 1, 'N', 'S'))
  }

  const level = makeLevel({
    sources,
    sinks: [{ pos: [4, 2], rotation: 0 }],
    target: { type: 'nothing', count: 999 },
  })
  return buildWorld(level, placements)
}

/** The order in which items reach the sink, read off per-type delivery counts. */
function deliveryOrder(world: ReturnType<typeof mergerWorld>, ticks: number): string[] {
  const order: string[] = []
  let previous: Record<string, number> = {}
  for (let i = 0; i < ticks; i += 1) {
    step(world)
    const current = snapshot(world).delivered
    for (const type of Object.keys(current).sort()) {
      const gain = (current[type] ?? 0) - (previous[type] ?? 0)
      for (let k = 0; k < gain; k += 1) order.push(type)
    }
    previous = current
  }
  return order
}

describe('§14.11 merger alternation', () => {
  it('alternates W, N, W, N with both inputs saturated', () => {
    const world = mergerWorld(true)
    const order = deliveryOrder(world, 25)

    expect(order.length).toBeGreaterThanOrEqual(6)
    // next starts at index 0 = W, so the W stream ("a") goes first.
    expect(order.slice(0, 6)).toEqual(['a', 'b', 'a', 'b', 'a', 'b'])
  })
})

describe('§14.12 merger starvation', () => {
  it('runs at one item per tick from a single input and keeps flipping next', () => {
    const world = mergerWorld(false)
    const order = deliveryOrder(world, 20)

    expect(order.slice(0, 6)).toEqual(['a', 'a', 'a', 'a', 'a', 'a'])
    // One transfer per tick sustained: deliveries keep pace with the source.
    expect(order.length).toBeGreaterThanOrEqual(14)
    expect(cellAt(world, [2, 2]).next).toBe(order.length % 2 === 0 ? 0 : 1)
    expect(conservationHolds(world)).toBe(true)
  })
})
