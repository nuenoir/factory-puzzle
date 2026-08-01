/**
 * The hand-designed fixture. docs/level-001.md carries the tick-by-tick
 * derivation these numbers come from — they were computed on paper before any
 * of this code existed, which is the entire point of Phase 0.
 */

import { describe, expect, it } from 'vitest'

import levelJson from '../../../levels/001.json'
import { costOf, simulate, snapshot, step } from '../src/index.js'
import { belt, buildWorld, machine, solutionOf } from './helpers.js'
import type { Level, Placement } from '../src/types.js'

const level = levelJson as unknown as Level

/** The reference solution from docs/level-001.md. Cost 21, which is par. */
const reference: Placement[] = [
  belt(1, 3, 'W', 'E'),
  machine('press', 2, 3, 0),
  machine('splitter', 3, 3, 0),
  belt(4, 3, 'W', 'E'),
  belt(3, 2, 'S', 'E'),
  belt(4, 2, 'W', 'E'),
  belt(5, 2, 'W', 'S'),
  machine('assembler', 5, 3, 0),
]

describe('level 001', () => {
  it('costs exactly par', () => {
    expect(costOf(solutionOf(level, reference))).toBe(21)
    expect(level.par).toBe(21)
  })

  it('delivers the first widget on tick 12', () => {
    const world = buildWorld(level, reference)
    for (let i = 0; i < 11; i += 1) {
      step(world)
      expect(snapshot(world).delivered['widget'] ?? 0).toBe(0)
    }
    step(world)
    expect(world.tickCount).toBe(12)
    expect(snapshot(world).delivered['widget']).toBe(1)
  })

  it('wins on tick 28, one widget every four ticks', () => {
    const result = simulate(level, solutionOf(level, reference))
    expect(result.won).toBe(true)
    expect(result.ticks).toBe(28)
    expect(result.cost).toBe(21)
    expect(result.jammed).toBe(false)
    expect(result.errors).toEqual([])
  })

  it('reports the bounding box of the placements as footprint', () => {
    // x spans 1..5, y spans 2..3 => 5 wide, 2 tall.
    expect(simulate(level, solutionOf(level, reference)).footprint).toBe(10)
  })
})
