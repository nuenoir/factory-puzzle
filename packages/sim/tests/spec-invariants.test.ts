/**
 * Rules the §14 cases do not reach on their own.
 *
 * Each of these pins a sentence of the spec that an implementation could get
 * wrong while keeping every §14 case green — the connection rule, the input
 * filters on their non-pull routes, the max_ticks boundary, and the phase
 * ordering inside a single tick.
 */

import { describe, expect, it } from 'vitest'

import { seedItems, simulate, snapshot, step } from '../src/index'
import { belt, buildWorld, cellAt, machine, makeLevel, solutionOf } from './helpers'

describe('§4 connection rule', () => {
  it('does not transfer between adjacent belts whose ports do not face each other', () => {
    // (1,1) points east at (2,1), but (2,1) takes its input from the north-east.
    // §4: both halves must face, or there is no connection at all.
    const world = buildWorld(makeLevel(), [belt(1, 1, 'W', 'E'), belt(2, 1, 'NE', 'SW')])
    seedItems(world, [{ pos: [1, 1], item: 'x' }])

    for (let i = 0; i < 5; i += 1) step(world)

    expect(cellAt(world, [1, 1]).item).toBe('x')
    expect(cellAt(world, [2, 1]).item).toBeNull()
  })

  it('does not let a source emit into a building whose input faces elsewhere', () => {
    const level = makeLevel({ sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }] })
    // Rotated 60°, the press takes from NW — not back at the source to its west.
    const world = buildWorld(level, [machine('press', 1, 3, 60)])

    for (let i = 0; i < 5; i += 1) step(world)

    expect(world.ledger.emitted).toBe(0)
  })
})

describe('§8 input filters apply on every route into a buffer', () => {
  it('blocks a phase-2 push of an item the downstream machine cannot use', () => {
    // Two presses in a row. The level's only recipe is circle -> disc, so the
    // second press cannot accept a disc and the first must hold it.
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      recipes: { press: { circle: 'disc' } },
    })
    const world = buildWorld(level, [belt(1, 3, 'W', 'E'), machine('press', 2, 3, 0), machine('press', 3, 3, 0)])

    for (let i = 0; i < 15; i += 1) step(world)

    expect(cellAt(world, [3, 3]).inputs.get('W')).toBeNull()
    expect(cellAt(world, [2, 3]).output).toBe('disc')
  })

  it('blocks a phase-8 emission of an item the machine cannot use', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'rock' }],
      recipes: { press: { circle: 'disc' } },
    })
    const world = buildWorld(level, [machine('press', 1, 3, 0)])

    for (let i = 0; i < 5; i += 1) step(world)

    expect(world.ledger.emitted).toBe(0)
    expect(cellAt(world, [1, 3]).inputs.get('W')).toBeNull()
  })

  it('accepts an emission the machine can use, so the block above is the filter', () => {
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      recipes: { press: { circle: 'disc' } },
    })
    const world = buildWorld(level, [machine('press', 1, 3, 0)])

    step(world)

    expect(world.ledger.emitted).toBe(1)
  })
})

describe('§3 assembler recipes are unordered pairs', () => {
  it('matches a pair supplied in the opposite order to the recipe', () => {
    // Recipe is [disc, plate]; the W port receives plate and the NW port disc.
    // The NW feeder sits at (1,2) rotated 60°, turning its E output into SE.
    const level = makeLevel({
      sources: [
        { pos: [0, 3], rotation: 0, emits: 'plate' },
        { pos: [1, 2], rotation: 60, emits: 'disc' },
      ],
      sinks: [{ pos: [2, 3], rotation: 0 }],
      recipes: { assembler: [{ in: ['disc', 'plate'], out: 'widget' }] },
      target: { type: 'widget', count: 1 },
    })
    const result = simulate(level, solutionOf(level, [machine('assembler', 1, 3, 0)]))

    expect(result.won).toBe(true)
    expect(result.jammed).toBe(false)
  })
})

describe('§10 win and fail boundaries', () => {
  // The straight line of §14.1 delivers its first item on tick 4.
  const lineLevel = (maxTicks: number) =>
    makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      sinks: [{ pos: [4, 3], rotation: 0 }],
      target: { type: 'circle', count: 1 },
      max_ticks: maxTicks,
    })

  it('wins on a delivery during the final permitted tick', () => {
    const level = lineLevel(4)
    const result = simulate(level, solutionOf(level, [belt(1, 3, 'W', 'E'), belt(2, 3, 'W', 'E'), belt(3, 3, 'W', 'E')]))

    expect(result.won).toBe(true)
    expect(result.ticks).toBe(4)
  })

  it('fails when max_ticks lands one tick short of the delivery', () => {
    const level = lineLevel(3)
    const result = simulate(level, solutionOf(level, [belt(1, 3, 'W', 'E'), belt(2, 3, 'W', 'E'), belt(3, 3, 'W', 'E')]))

    expect(result.won).toBe(false)
    expect(result.ticks).toBe(3)
    expect(result.jammed).toBe(false) // ran out of time, did not deadlock
  })
})

describe('§6 phase ordering within one tick', () => {
  it('lets an item a machine pushed in phase 2 advance again in phase 3', () => {
    // The press pushes a disc onto (3,3) during phase 2; belt resolution then
    // moves it to (4,3) in phase 3 of the same tick. If the phases were
    // swapped, the disc would still be sitting on (3,3) at the end of the tick.
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      recipes: { press: { circle: 'disc' } },
    })
    const world = buildWorld(level, [
      belt(1, 3, 'W', 'E'),
      machine('press', 2, 3, 0),
      belt(3, 3, 'W', 'E'),
      belt(4, 3, 'W', 'E'),
    ])

    // The press pulls on tick 2, starts its job, and places the disc on tick 4;
    // it pushes on tick 5.
    for (let i = 0; i < 5; i += 1) step(world)

    expect(cellAt(world, [3, 3]).item).toBeNull()
    expect(cellAt(world, [4, 3]).item).toBe('disc')
  })

  it('counts a delivery the tick after the item enters the sink', () => {
    // §6 phase 1 runs before everything else, so an item that arrives during
    // tick T is counted at the start of tick T+1, never within tick T.
    const level = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      sinks: [{ pos: [2, 3], rotation: 0 }],
      target: { type: 'circle', count: 5 },
    })
    const world = buildWorld(level, [belt(1, 3, 'W', 'E')])

    step(world) // tick 1: emitted onto (1,3)
    step(world) // tick 2: pulled into the sink buffer
    expect(cellAt(world, [2, 3]).inputs.get('W')).toBe('circle')
    expect(snapshot(world).delivered['circle'] ?? 0).toBe(0)

    step(world) // tick 3: counted
    expect(snapshot(world).delivered['circle']).toBe(1)
  })
})
