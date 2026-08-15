/**
 * Placement editing, especially the drag-to-belt derivation.
 *
 * This is where the hex geometry is most likely to go quietly wrong: a belt
 * whose `in` points at the wrong neighbour still looks fine on screen but
 * never connects, and §4's mutual-facing rule means the item simply stops.
 */

import { describe, expect, it } from 'vitest'

import { beltsFromPath, directionBetween, editReducer, ignoresCell, placementAt, toolFor } from './editor'
import type { Level, Placement, PosTuple } from '@factory/sim'

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

describe('ignoresCell', () => {
  /**
   * The rule that was wrong. Sources and sinks were guarded off from every
   * tool, which reads as caution and is not: a belt drag has to reach the sink
   * for the last belt to turn and face it (§4 connects by mutual facing).
   * Without that the belt kept whichever direction the drag was walking in,
   * usually off the board, and the factory silently never delivered.
   *
   * It stayed hidden because level 001's reference solution parks the assembler
   * next to the sink, so no belt ever needs to run into a fixture. On the
   * generated pool 79% of levels need one at par — four days in five were
   * unbuildable.
   */
  it('protects fixtures from every tool that builds or erases', () => {
    for (const tool of ['press', 'assembler', 'splitter', 'merger', 'delete'] as const) {
      expect(ignoresCell(tool, true)).toBe(true)
    }
  })

  it('lets the belt tool touch a fixture, so a route can end at one', () => {
    expect(ignoresCell('conveyor', true)).toBe(false)
  })

  it('never ignores an ordinary cell', () => {
    for (const tool of ['conveyor', 'press', 'assembler', 'splitter', 'merger', 'delete'] as const) {
      expect(ignoresCell(tool, false)).toBe(false)
    }
  })

  it('is what lets a route into a sink point at the sink', () => {
    // The end-to-end shape of the bug, in the pure layer: with the fixture as
    // terminus the last belt faces it; without, it carries straight on.
    const path: PosTuple[] = [[5, 5], [5, 6]]
    const facing = beltsFromPath(path, { terminus: [6, 6] })
    const walkingOn = beltsFromPath(path)
    expect(facing[1].out).toBe('E')
    expect(walkingOn[1].out).not.toBe('E')
  })
})

describe('handing the board back', () => {
  /**
   * The tutorial and the daily puzzle are different sizes, so their boards
   * cannot coexist — daily placements on the tutorial's 5x3 grid are out of
   * bounds and the world refuses to build. Switching therefore has to clear.
   *
   * What must not happen is the player paying for that: you get one puzzle a
   * day, and losing a half-built factory to a curious tap on "How to play" is a
   * bad trade for a reminder. App.tsx stashes the placements and replays them
   * as `clear` then `placeMany`, so this pins the mechanism that makes the
   * round trip lossless. It does not pin the wiring — that needs a renderer —
   * but it does catch the two dispatches being "simplified" into one.
   */
  it('restores a stashed board exactly, through clear then placeMany', () => {
    const daily: Placement[] = [
      { type: 'conveyor', pos: [0, 2], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [1, 2], in: 'W', out: 'E' },
      { type: 'press', pos: [3, 2], rotation: 0 },
    ]
    const cleared = editReducer(daily, { kind: 'clear' })
    expect(cleared).toEqual([])

    const restored = editReducer(cleared, { kind: 'placeMany', placements: daily })
    expect(restored).toEqual(daily)
  })

  it('does not carry the tutorial board into the daily one', () => {
    // The tutorial's own placements are disposable; only the stash comes back.
    const tutorialBoard: Placement[] = [{ type: 'conveyor', pos: [1, 1], in: 'W', out: 'E' }]
    const daily: Placement[] = [{ type: 'press', pos: [3, 2], rotation: 0 }]
    const restored = editReducer(editReducer(tutorialBoard, { kind: 'clear' }), {
      kind: 'placeMany',
      placements: daily,
    })
    expect(restored).toEqual(daily)
  })
})

describe('the tool in hand when the board changes', () => {
  /**
   * "How to play" swaps a daily level for the tutorial's, and the palette
   * selection is state that survives the swap. Every pool level offers an
   * assembler and a splitter; the tutorial offers a belt and a press. Carrying
   * an assembler across put a building on the board that §2 rejects, and the
   * palette could not even show it as selected — it lists what the level
   * allows — so nothing on screen explained the error that replaced the board.
   */
  it('keeps a tool the new level allows', () => {
    expect(toolFor('press', ['conveyor', 'press'])).toBe('press')
    expect(toolFor('conveyor', ['conveyor', 'press'])).toBe('conveyor')
  })

  it('falls back to the belt when it does not', () => {
    expect(toolFor('assembler', ['conveyor', 'press'])).toBe('conveyor')
    expect(toolFor('splitter', ['conveyor', 'press'])).toBe('conveyor')
    expect(toolFor('merger', ['conveyor', 'press'])).toBe('conveyor')
  })

  it('never takes erase away, since removing means the same on any level', () => {
    expect(toolFor('delete', ['conveyor', 'press'])).toBe('delete')
    expect(toolFor('delete', [])).toBe('delete')
  })

  it('lands on something every real level actually offers', async () => {
    // The fallback is only safe because every level has a belt. Assert that
    // over the whole pool and the tutorial rather than over one fixture.
    const pool = (await import('../levels/daily.json')).default as unknown as Level[]
    const tutorial = (await import('../levels/tutorial.json')).default as unknown as Level
    for (const level of [...pool, tutorial]) {
      for (const tool of ['conveyor', 'press', 'splitter', 'merger', 'assembler'] as const) {
        const kept = toolFor(tool, level.available)
        expect(level.available, `${level.id} cannot offer ${kept}`).toContain(kept)
      }
    }
  })
})
