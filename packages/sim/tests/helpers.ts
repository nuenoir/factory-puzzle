/** Fixture builders for the §14 test cases. */

import { createWorld } from '../src/world.js'
import type {
  Direction,
  Level,
  Placement,
  PlaceableType,
  PosTuple,
  Rotation,
  Solution,
} from '../src/types.js'
import type { Building, World } from '../src/world.js'

export function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'test',
    grid: { width: 7, height: 7 },
    sources: [],
    sinks: [],
    target: { type: 'widget', count: 5 },
    max_ticks: 300,
    available: ['conveyor', 'splitter', 'merger', 'press', 'assembler'],
    recipes: {},
    par: 0,
    ...overrides,
  }
}

export function belt(x: number, y: number, dirIn: Direction, dirOut: Direction): Placement {
  return { type: 'conveyor', pos: [x, y], in: dirIn, out: dirOut }
}

export function machine(type: Exclude<PlaceableType, 'conveyor'>, x: number, y: number, rotation: Rotation = 0): Placement {
  return { type, pos: [x, y], rotation }
}

/** A straight west-to-east run of `length` conveyors starting at (x, y). */
export function beltRun(x: number, y: number, length: number): Placement[] {
  return Array.from({ length }, (_, i) => belt(x + i, y, 'W', 'E'))
}

export function solutionOf(level: Level, placements: Placement[]): Solution {
  return { level_id: level.id, placements }
}

/** Build a world or throw with the validation errors — tests want the detail. */
export function buildWorld(level: Level, placements: Placement[]): World {
  const built = createWorld(level, solutionOf(level, placements))
  if (!built.ok) throw new Error(`Fixture is invalid:\n${built.errors.map((e) => `  ${e.code}: ${e.message}`).join('\n')}`)
  return built.world
}

export function cellAt(world: World, pos: PosTuple): Building {
  const b = world.cells[pos[1] * world.width + pos[0]]
  if (!b) throw new Error(`No building at (${pos[0]}, ${pos[1]}).`)
  return b
}

/** Total items sitting on the given conveyor cells. */
export function itemsOn(world: World, positions: readonly PosTuple[]): number {
  return positions.filter((p) => cellAt(world, p).item !== null).length
}
