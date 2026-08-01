/**
 * The twelve cases from docs/rules-spec.md §14.
 *
 * These are the definition of a correct simulator. Per CLAUDE.md, if one of
 * these needs changing to accommodate a code change, stop — that usually means
 * the code is wrong, not the test.
 *
 * Where a case could be satisfied by a broken simulator, the fixture observes
 * the mechanic directly rather than inferring it from item counts: the splitter
 * and merger cases read the actual push/transfer target every tick, so a
 * round-robin flag that never flips fails them.
 */

import { describe, expect, it } from 'vitest'

import {
  conservationHolds,
  clearItems,
  itemsInWorld,
  seedItems,
  simulate,
  snapshot,
  stateKey,
  step,
  type PosTuple,
  type Rotation,
  type World,
} from '../src/index'
import { beltRun, belt, buildWorld, cellAt, itemsOn, machine, makeLevel, solutionOf } from './helpers'

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

/**
 * Splitter fixture whose branches each end in their own sink one cell away.
 * A sink's input buffer holds the item for exactly the tick it arrived, so
 * reading the two buffers after each step reports which output the splitter
 * actually pushed to — no inference from branch item counts.
 */
function splitterWorld(includeEastBranch: boolean): World {
  const sinks: Array<{ pos: PosTuple; rotation: Rotation }> = [{ pos: [2, 1], rotation: 270 }]
  const placements = [belt(1, 3, 'W', 'E'), machine('splitter', 2, 3, 0), belt(2, 2, 'S', 'N')]

  if (includeEastBranch) {
    sinks.push({ pos: [4, 3], rotation: 0 })
    placements.push(belt(3, 3, 'W', 'E'))
  }

  const level = makeLevel({
    sources: [{ pos: [0, 3], rotation: 0, emits: 'x' }],
    sinks,
    target: { type: 'nothing', count: 999 },
  })
  return buildWorld(level, placements)
}

/** Which branch received a push on each tick, read off the two sink buffers. */
function pushSequence(world: World, ticks: number, hasEast: boolean): string[] {
  const seq: string[] = []
  for (let i = 0; i < ticks; i += 1) {
    step(world)
    const north = cellAt(world, [2, 1]).inputs.get('S') ?? null
    const east = hasEast ? cellAt(world, [4, 3]).inputs.get('W') ?? null : null
    // One output buffer means at most one push per tick (§5).
    expect(north !== null && east !== null).toBe(false)
    if (north !== null) seq.push('N')
    if (east !== null) seq.push('E')
  }
  return seq
}

describe('§14.4 splitter alternation', () => {
  it('pushes N, E, N, E, N, E with both branches open', () => {
    const world = splitterWorld(true)
    const seq = pushSequence(world, 20, true)

    expect(seq.length).toBeGreaterThanOrEqual(6)
    expect(seq.slice(0, 6)).toEqual(['N', 'E', 'N', 'E', 'N', 'E'])
  })
})

describe('§14.5 splitter with one output blocked', () => {
  it('sends every item down the open branch', () => {
    const world = splitterWorld(false)
    const seq = pushSequence(world, 20, false)

    expect(seq.length).toBeGreaterThanOrEqual(6)
    expect(seq.every((d) => d === 'N')).toBe(true)
  })

  it('keeps flipping next on fallback successes, so it never desyncs', () => {
    const world = splitterWorld(false)
    const flags: number[] = []

    for (let i = 0; i < 12; i += 1) {
      step(world)
      // Record the flag only on ticks that actually pushed.
      if ((cellAt(world, [2, 1]).inputs.get('S') ?? null) !== null) {
        flags.push(cellAt(world, [2, 3]).next)
      }
    }

    // §9 flips on ANY success, including the fallback. So the flag alternates
    // 1, 0, 1, 0 — a splitter that never flips would sit on 0 forever, and one
    // that only flips on first-choice successes would never leave 1.
    expect(flags.length).toBeGreaterThanOrEqual(6)
    expect(flags.slice(0, 6)).toEqual([1, 0, 1, 0, 1, 0])
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

  it('fills both buffers with the mismatched pair rather than refusing them', () => {
    // §8's filter is item-level, not pair-aware: "disc" appears in a recipe, so
    // both ports accept one even though disc+disc assembles nothing. A
    // pair-aware implementation would leave the second buffer empty.
    const level = makeLevel({
      sources: [
        { pos: [0, 3], rotation: 0, emits: 'disc' },
        { pos: [1, 2], rotation: 90, emits: 'disc' },
      ],
      recipes: { assembler: [{ in: ['disc', 'plate'], out: 'widget' }] },
    })
    const world = buildWorld(level, [machine('assembler', 1, 3, 0)])

    for (let i = 0; i < 10; i += 1) step(world)

    const assembler = cellAt(world, [1, 3])
    expect(assembler.inputs.get('W')).toBe('disc')
    expect(assembler.inputs.get('N')).toBe('disc')
    expect(assembler.job).toBeNull()
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
  const level = makeLevel({
    sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
    sinks: [{ pos: [6, 3], rotation: 0 }],
    recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
  })
  const placements = [
    belt(1, 3, 'W', 'E'),
    machine('press', 2, 3, 0),
    machine('splitter', 3, 3, 0),
    belt(4, 3, 'W', 'E'),
    belt(3, 2, 'S', 'E'),
    belt(4, 2, 'W', 'E'),
    belt(5, 2, 'W', 'S'),
    machine('assembler', 5, 3, 0),
  ]

  it('produces a byte-identical result across 100 runs', () => {
    const first = JSON.stringify(simulate(level, solutionOf(level, placements)))
    for (let i = 0; i < 99; i += 1) {
      expect(JSON.stringify(simulate(level, solutionOf(level, placements)))).toBe(first)
    }
  })

  it('produces a byte-identical serialised world state at every tick', () => {
    // §13 makes the serialised form part of the determinism contract, so the
    // scalars in SimResult are not enough on their own.
    const trace = (): string[] => {
      const world = buildWorld(level, placements)
      return Array.from({ length: 30 }, () => {
        step(world)
        return stateKey(world)
      })
    }

    const first = trace()
    for (let i = 0; i < 9; i += 1) expect(trace()).toEqual(first)
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

    // tick() already throws on a violation; this pins the arithmetic too, so a
    // ledger that drifted in lockstep with itemsInWorld would still be caught.
    for (let i = 0; i < 60; i += 1) {
      step(world)
      const { emitted, produced, consumed, delivered, seeded, removed } = world.ledger
      expect(emitted + seeded + produced).toBe(itemsInWorld(world) + delivered + removed + consumed)
      expect(conservationHolds(world)).toBe(true)
    }

    // And the run genuinely exercised machines, rather than sitting idle.
    expect(world.ledger.produced).toBeGreaterThan(0)
    expect(world.ledger.consumed).toBeGreaterThan(0)
    expect(world.ledger.delivered).toBeGreaterThan(0)
  })
})

/**
 * Merger fixture. Reading `output` after each step reports the item the merger
 * transferred in phase 6 of that tick, which is a direct observation of which
 * input §9 selected.
 */
function mergerWorld(feedNorth: boolean): World {
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

/**
 * The merged stream in arrival order. The output belt is a single cell feeding
 * the sink, so the sink's buffer holds exactly one item per tick — reading it
 * after each step recovers the stream even when both inputs carry equal types.
 */
function mergedStream(world: World, ticks: number): string[] {
  const stream: string[] = []
  for (let i = 0; i < ticks; i += 1) {
    step(world)
    const arrived = cellAt(world, [4, 2]).inputs.get('W') ?? null
    if (arrived !== null) stream.push(arrived)
  }
  return stream
}

describe('§14.11 merger alternation', () => {
  it('alternates W, N, W, N with both inputs saturated', () => {
    const world = mergerWorld(true)
    const stream = mergedStream(world, 25)

    expect(stream.length).toBeGreaterThanOrEqual(6)
    // next starts at index 0 = W, so the W stream ("a") goes first.
    expect(stream.slice(0, 6)).toEqual(['a', 'b', 'a', 'b', 'a', 'b'])
  })
})

describe('§14.12 merger starvation', () => {
  it('keeps taking from the only fed input', () => {
    const world = mergerWorld(false)
    const stream = mergedStream(world, 20)

    expect(stream.length).toBeGreaterThanOrEqual(6)
    expect(stream.slice(0, 6)).toEqual(['a', 'a', 'a', 'a', 'a', 'a'])
    expect(conservationHolds(world)).toBe(true)
  })

  it('flips next on every transfer, including the fallback to the empty input', () => {
    const world = mergerWorld(false)
    for (let i = 0; i < 4; i += 1) step(world) // warm the pipeline

    const flags: number[] = []
    for (let i = 0; i < 6; i += 1) {
      step(world)
      flags.push(cellAt(world, [2, 2]).next)
    }

    // One transfer per tick in steady state, and §9 flips on every one — so the
    // flag alternates. A merger that stopped flipping would sit on one value.
    expect(new Set(flags).size).toBe(2)
    expect(flags).toEqual(flags[0] === 0 ? [0, 1, 0, 1, 0, 1] : [1, 0, 1, 0, 1, 0])
  })

  it('sustains one transfer per tick with no stall', () => {
    const world = mergerWorld(false)
    for (let i = 0; i < 5; i += 1) step(world)
    for (let i = 0; i < 10; i += 1) {
      step(world)
      expect(cellAt(world, [2, 2]).output).not.toBeNull()
    }
  })
})
