/**
 * §13's validation contract. Phase 3 feeds `simulate` machine-generated
 * solutions, so malformed input must produce structured errors rather than a
 * crash or a silently dropped placement.
 */

import { describe, expect, it } from 'vitest'

import { simulate, validateLevel } from '../src/index'
import { belt, machine, makeLevel, solutionOf } from './helpers'
import type { Placement } from '../src/types'

const level = makeLevel({ available: ['conveyor', 'press'] })

function codesFor(placements: Placement[], levelId = level.id): string[] {
  const result = simulate(level, { level_id: levelId, placements })
  return result.errors.map((e) => e.code)
}

describe('§13 solution validation', () => {
  it('accepts a well-formed solution', () => {
    expect(codesFor([belt(1, 1, 'W', 'E')])).toEqual([])
  })

  it('rejects out-of-bounds positions', () => {
    expect(codesFor([belt(9, 1, 'W', 'E')])).toContain('out_of_bounds')
    expect(codesFor([belt(1, -1, 'W', 'E')])).toContain('out_of_bounds')
  })

  it('rejects two placements on one cell', () => {
    expect(codesFor([belt(1, 1, 'W', 'E'), belt(1, 1, 'N', 'S')])).toContain('overlapping_placement')
  })

  it('rejects building on a source or sink cell', () => {
    const withFixtures = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      available: ['conveyor'],
    })
    const result = simulate(withFixtures, solutionOf(withFixtures, [belt(0, 3, 'W', 'E')]))
    expect(result.errors.map((e) => e.code)).toContain('occupied_by_fixture')
  })

  it('rejects a type the level does not offer', () => {
    expect(codesFor([machine('assembler', 1, 1, 0)])).toContain('type_not_available')
  })

  it('rejects a conveyor whose in equals its out', () => {
    expect(codesFor([belt(1, 1, 'W', 'W')])).toContain('conveyor_in_equals_out')
  })

  it('rejects a conveyor carrying rotation instead of in/out', () => {
    expect(codesFor([{ type: 'conveyor', pos: [1, 1], rotation: 0 }])).toContain('conveyor_has_rotation')
  })

  it('rejects an invalid rotation', () => {
    expect(codesFor([{ type: 'press', pos: [1, 1], rotation: 45 as never }])).toContain('invalid_rotation')
  })

  it('rejects a level_id mismatch', () => {
    expect(codesFor([belt(1, 1, 'W', 'E')], 'some-other-level')).toContain('level_id_mismatch')
  })

  it('rejects a conveyor direction outside N/E/S/W', () => {
    // Phase 3 hands us raw JSON, so the TypeScript Direction type guards nothing
    // here. Left unchecked, "X" resolves west and silently simulates.
    expect(codesFor([{ type: 'conveyor', pos: [1, 1], in: 'X' as never, out: 'Y' as never }])).toContain('invalid_direction')
  })

  it('rejects a placement with a malformed position rather than throwing', () => {
    expect(codesFor([{ type: 'conveyor', pos: [1] as never, in: 'W', out: 'E' }])).toContain('malformed_placement')
    expect(codesFor([{ type: 'conveyor', pos: 'nope' as never, in: 'W', out: 'E' }])).toContain('malformed_placement')
  })

  it('simulates nothing when validation fails', () => {
    const result = simulate(level, { level_id: level.id, placements: [belt(9, 9, 'W', 'E')] })
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.won).toBe(false)
    expect(result.ticks).toBe(0)
  })
})

describe('§3 level validation', () => {
  it('rejects a duplicate assembler pair regardless of order', () => {
    const errors = validateLevel(
      makeLevel({
        recipes: {
          assembler: [
            { in: ['disc', 'plate'], out: 'widget' },
            { in: ['plate', 'disc'], out: 'gadget' },
          ],
        },
      }),
    )
    expect(errors.map((e) => e.code)).toEqual(['duplicate_assembler_recipe'])
  })

  it('does not confuse two distinct pairs whose names contain the separator', () => {
    // {"a+b", "c"} and {"a", "b+c"} are different pairs; a naive join collides.
    const errors = validateLevel(
      makeLevel({
        recipes: {
          assembler: [
            { in: ['a+b', 'c'], out: 'widget' },
            { in: ['a', 'b+c'], out: 'gadget' },
          ],
        },
      }),
    )
    expect(errors).toEqual([])
  })

  it('rejects a fixture outside the grid', () => {
    const errors = validateLevel(makeLevel({ sinks: [{ pos: [9, 9], rotation: 0 }] }))
    expect(errors.map((e) => e.code)).toContain('fixture_out_of_bounds')
  })

  it('rejects a fixture with a rotation outside 0/90/180/270', () => {
    const errors = validateLevel(makeLevel({ sources: [{ pos: [0, 3], rotation: 45 as never, emits: 'circle' }] }))
    expect(errors.map((e) => e.code)).toContain('invalid_fixture_rotation')
  })

  it('rejects two fixtures sharing a cell', () => {
    const errors = validateLevel(
      makeLevel({
        sources: [{ pos: [2, 2], rotation: 0, emits: 'circle' }],
        sinks: [{ pos: [2, 2], rotation: 0 }],
      }),
    )
    expect(errors.map((e) => e.code)).toContain('overlapping_fixture')
  })

  it('surfaces level errors through simulate without simulating', () => {
    const bad = makeLevel({ sinks: [{ pos: [9, 9], rotation: 0 }] })
    const result = simulate(bad, solutionOf(bad, [belt(1, 1, 'W', 'E')]))
    expect(result.errors.map((e) => e.code)).toContain('fixture_out_of_bounds')
    expect(result.ticks).toBe(0)
  })
})
