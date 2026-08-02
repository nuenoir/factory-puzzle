/**
 * Placement editing, especially the drag-to-belt derivation.
 *
 * This is where the hex geometry is most likely to go quietly wrong: a belt
 * whose `in` points at the wrong neighbour still looks fine on screen but
 * never connects, and §4's mutual-facing rule means the item simply stops.
 */

import { describe, expect, it } from 'vitest'

import { beltsFromPath, directionBetween, editReducer, placementAt } from './editor'
import type { Placement, PosTuple } from '@factory/sim'

describe('directionBetween', () => {
  it('reads E and W the same on both row parities', () => {
    expect(directionBetween([1, 2], [2, 2])).toBe('E')
    expect(directionBetween([2, 3], [1, 3])).toBe('W')
  })

  it('accounts for the odd-row shift on the diagonals', () => {
    // From an odd row, NE is (x+1, y-1); from an even row it is (x, y-1).
    expect(directionBetween([3, 3], [4, 2])).toBe('NE')
    expect(directionBetween([3, 2], [3, 1])).toBe('NE')
    expect(directionBetween([3, 3], [4, 4])).toBe('SE')
    expect(directionBetween([3, 2], [3, 3])).toBe('SE')
  })

  it('returns null for cells that are not neighbours', () => {
    expect(directionBetween([1, 1], [4, 4])).toBeNull()
    expect(directionBetween([1, 1], [1, 1])).toBeNull()
  })
})

describe('beltsFromPath', () => {
  it('runs a single tap straight through, west to east', () => {
    expect(beltsFromPath([[2, 2]])).toEqual([{ type: 'conveyor', pos: [2, 2], in: 'W', out: 'E' }])
  })

  it('makes both ends of a path run straight', () => {
    const belts = beltsFromPath([
      [1, 3],
      [2, 3],
    ])
    expect(belts).toEqual([
      { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [2, 3], in: 'W', out: 'E' },
    ])
  })

  it('turns a corner where the path turns', () => {
    // Exactly the NE fork of the level-001 reference solution.
    const belts = beltsFromPath([
      [3, 3],
      [4, 2],
      [5, 2],
    ])
    expect(belts[1]).toEqual({ type: 'conveyor', pos: [4, 2], in: 'SW', out: 'E' })
    expect(belts[2]).toEqual({ type: 'conveyor', pos: [5, 2], in: 'W', out: 'E' })
  })

  it('faces the first belt back at the building the drag started from', () => {
    // Dragging out of the splitter at (3,3) up into the NE fork. Without the
    // anchor this belt would take W and never connect (§4).
    const belts = beltsFromPath([[4, 2], [5, 2]], { anchor: [3, 3] })
    expect(belts[0]).toEqual({ type: 'conveyor', pos: [4, 2], in: 'SW', out: 'E' })
  })

  it('points the last belt at the building the drag ran into', () => {
    // Dragging into the assembler at (5,3) from (5,2) above it.
    const belts = beltsFromPath([[4, 2], [5, 2]], { anchor: [3, 3], terminus: [5, 3] })
    expect(belts[1]).toEqual({ type: 'conveyor', pos: [5, 2], in: 'W', out: 'SE' })
  })

  it('reproduces the level-001 NE fork exactly', () => {
    // docs/level-001.md: (4,2) in SW out E, then (5,2) in W out SE.
    expect(beltsFromPath([[4, 2], [5, 2]], { anchor: [3, 3], terminus: [5, 3] })).toEqual([
      { type: 'conveyor', pos: [4, 2], in: 'SW', out: 'E' },
      { type: 'conveyor', pos: [5, 2], in: 'W', out: 'SE' },
    ])
  })

  it('reproduces the level-001 SE fork exactly', () => {
    // docs/level-001.md: (4,4) in NW out NE, then (4,3) in SW out E.
    expect(beltsFromPath([[4, 4], [4, 3]], { anchor: [3, 3], terminus: [5, 3] })).toEqual([
      { type: 'conveyor', pos: [4, 4], in: 'NW', out: 'NE' },
      { type: 'conveyor', pos: [4, 3], in: 'SW', out: 'E' },
    ])
  })

  it('never produces a belt whose in equals its out', () => {
    // §4 requires them to differ, and validation rejects it otherwise.
    const path: PosTuple[] = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 3],
    ]
    for (const belt of beltsFromPath(path)) expect(belt.in).not.toBe(belt.out)
  })

  it('links each cell to the next, so the run is actually connected', () => {
    const path: PosTuple[] = [
      [1, 3],
      [2, 3],
      [3, 2],
      [3, 1],
    ]
    const belts = beltsFromPath(path)
    for (let i = 0; i < belts.length - 1; i += 1) {
      // Each belt points at its successor, and the successor points back (§4).
      expect(belts[i].out).toBe(directionBetween(path[i], path[i + 1]))
      expect(belts[i + 1].in).toBe(directionBetween(path[i + 1], path[i]))
    }
  })
})

describe('editReducer', () => {
  const belt: Placement = { type: 'conveyor', pos: [1, 1], in: 'W', out: 'E' }
  const press: Placement = { type: 'press', pos: [1, 1], rotation: 0 }

  it('replaces whatever occupied the cell', () => {
    const after = editReducer([belt], { kind: 'place', placement: press })
    expect(after).toHaveLength(1)
    expect(placementAt(after, [1, 1])?.type).toBe('press')
  })

  it('keeps placements the drag did not touch', () => {
    const other: Placement = { type: 'conveyor', pos: [5, 5], in: 'W', out: 'E' }
    const after = editReducer([belt, other], {
      kind: 'placeMany',
      placements: [{ type: 'conveyor', pos: [1, 1], in: 'W', out: 'NE' }],
    })
    expect(after).toHaveLength(2)
    expect(placementAt(after, [5, 5])).toEqual(other)
    expect(placementAt(after, [1, 1])?.out).toBe('NE')
  })

  it('removes and clears', () => {
    expect(editReducer([belt], { kind: 'remove', pos: [1, 1] })).toEqual([])
    expect(editReducer([belt, press], { kind: 'clear' })).toEqual([])
  })

  it('rotates a machine in 60 degree steps and wraps at 360', () => {
    let state = [press]
    for (const expected of [60, 120, 180, 240, 300, 0]) {
      state = editReducer(state, { kind: 'rotate', pos: [1, 1] })
      expect(placementAt(state, [1, 1])?.rotation).toBe(expected)
    }
  })

  it('leaves conveyors alone when asked to rotate — they have no rotation', () => {
    const after = editReducer([belt], { kind: 'rotate', pos: [1, 1] })
    expect(after).toEqual([belt])
  })
})
