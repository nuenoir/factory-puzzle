/**
 * The one hardcoded puzzle for Phase 2.
 *
 * Placements are still fixed here; the palette and drag-to-place will replace
 * this constant with editable state.
 */

import type { Level, Placement, Solution } from '@factory/sim'

import levelJson from '../levels/001.json'

export const level = levelJson as unknown as Level

/** The reference solution from docs/level-001.md. Cost 21, which is par. */
export const placements: Placement[] = [
  { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
  { type: 'press', pos: [2, 3], rotation: 0 },
  { type: 'splitter', pos: [3, 3], rotation: 0 },
  { type: 'conveyor', pos: [4, 3], in: 'W', out: 'E' },
  { type: 'conveyor', pos: [3, 2], in: 'S', out: 'E' },
  { type: 'conveyor', pos: [4, 2], in: 'W', out: 'E' },
  { type: 'conveyor', pos: [5, 2], in: 'W', out: 'S' },
  { type: 'assembler', pos: [5, 3], rotation: 0 },
]

export const solution: Solution = { level_id: level.id, placements }
