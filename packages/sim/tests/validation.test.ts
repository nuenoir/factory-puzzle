/**
 * §13's validation contract. Phase 3 feeds `simulate` machine-generated
 * solutions, so malformed input must produce structured errors rather than a
 * crash or a silently dropped placement.
 */

import { describe, expect, it } from 'vitest'

import { simulate, validateLevel } from '../src/index.js'
import { belt, machine, makeLevel, solutionOf } from './helpers.js'
import type { Placement } from '../src/types.js'

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
})
