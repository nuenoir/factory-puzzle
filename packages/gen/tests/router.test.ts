/**
 * docs/generation-spec.md §4 stage C — belt routing.
 *
 * The router is a heuristic, so the tests that matter most are the ones that
 * hand its output to `simulate` and check the factory actually runs. A route
 * that looks connected but is not would otherwise sail through: §4's
 * mutual-facing rule makes a mis-oriented belt silently inert.
 */

import { describe, expect, it } from 'vitest'
import { COST, simulate, type Level, type Placement, type PosTuple } from '@factory/sim'

import { routeBelts } from '../src/index'

const grid = { width: 7, height: 7 }
const keysOf = (cells: readonly PosTuple[]) => new Set(cells.map(([x, y]) => `${x},${y}`))

describe('routeBelts', () => {
  it('lays a straight run between two facing ports', () => {
    const belts = routeBelts(grid, keysOf([[0, 3], [4, 3]]), { pos: [0, 3], dir: 'E' }, { pos: [4, 3], dir: 'W' })
    expect(belts?.map((b) => b.pos)).toEqual([[1, 3], [2, 3], [3, 3]])
    expect(belts?.every((b) => b.in === 'W' && b.out === 'E')).toBe(true)
  })

  it('returns no belts at all when the buildings already touch and face', () => {
    const belts = routeBelts(grid, keysOf([[2, 3], [3, 3]]), { pos: [2, 3], dir: 'E' }, { pos: [3, 3], dir: 'W' })
    expect(belts).toEqual([])
  })

  it('routes around an obstruction', () => {
    const blocked: PosTuple[] = [[0, 3], [4, 3], [2, 3]]
    const belts = routeBelts(grid, keysOf(blocked), { pos: [0, 3], dir: 'E' }, { pos: [4, 3], dir: 'W' })
    expect(belts).not.toBeNull()
    // It must detour: the blocked cell can never appear in the route.
    expect(belts?.some((b) => b.pos[0] === 2 && b.pos[1] === 3)).toBe(false)
  })

  it('returns null when the entry cell is walled in', () => {
    // Fence every neighbour of the sink's entry cell (3,3) except itself.
    const walls: PosTuple[] = [[0, 3], [4, 3], [3, 3]]
    expect(routeBelts(grid, keysOf(walls), { pos: [0, 3], dir: 'E' }, { pos: [4, 3], dir: 'W' })).toBeNull()
  })

  it('is deterministic — the same request routes the same way every time', () => {
    const request = () =>
      JSON.stringify(routeBelts(grid, keysOf([[1, 1], [5, 5]]), { pos: [1, 1], dir: 'E' }, { pos: [5, 5], dir: 'W' }))
    const first = request()
    for (let i = 0; i < 20; i += 1) expect(request()).toBe(first)
  })
})

describe('routed belts actually run', () => {
  /** The level-001 chemistry and fixtures. */
  const level: Level = {
    id: 'route-test',
    grid,
    sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
    sinks: [{ pos: [6, 3], rotation: 0 }],
    target: { type: 'widget', count: 5 },
    max_ticks: 300,
    available: ['conveyor', 'splitter', 'press', 'assembler'],
    recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    par: 21,
  }

  it('reproduces the level-001 reference solution from machine positions alone', () => {
    // Only the machines are given. Every belt below is the router's own work.
    const machines: Placement[] = [
      { type: 'press', pos: [2, 3], rotation: 0 },
      { type: 'splitter', pos: [3, 3], rotation: 0 },
      { type: 'assembler', pos: [5, 3], rotation: 0 },
    ]
    const occupied = keysOf([[0, 3], [6, 3], ...machines.map((m) => m.pos)])

    const legs = [
      routeBelts(grid, occupied, { pos: [0, 3], dir: 'E' }, { pos: [2, 3], dir: 'W' }), // source -> press
      routeBelts(grid, occupied, { pos: [2, 3], dir: 'E' }, { pos: [3, 3], dir: 'W' }), // press -> splitter
      routeBelts(grid, occupied, { pos: [3, 3], dir: 'NE' }, { pos: [5, 3], dir: 'NW' }), // fork one
      routeBelts(grid, occupied, { pos: [3, 3], dir: 'SE' }, { pos: [5, 3], dir: 'W' }), // fork two
      routeBelts(grid, occupied, { pos: [5, 3], dir: 'E' }, { pos: [6, 3], dir: 'W' }), // assembler -> sink
    ]
    expect(legs.every((leg) => leg !== null)).toBe(true)

    const placements = [...machines, ...legs.flatMap((leg) => leg ?? [])]
    const result = simulate(level, { level_id: level.id, placements })

    // The oracle, not the router, decides whether this is a solution.
    expect(result.errors).toEqual([])
    expect(result.won).toBe(true)
    expect(result.jammed).toBe(false)

    // And it finds the hand-designed answer exactly: cost 21, win on tick 28.
    expect(result.cost).toBe(21)
    expect(result.ticks).toBe(28)
  })

  it('costs one per conveyor, so a shortest route is also a cheapest one', () => {
    const belts = routeBelts(grid, keysOf([[0, 3], [4, 3]]), { pos: [0, 3], dir: 'E' }, { pos: [4, 3], dir: 'W' }) ?? []
    expect(belts.reduce((sum, b) => sum + COST[b.type], 0)).toBe(belts.length)
  })
})
