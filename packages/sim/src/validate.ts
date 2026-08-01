/**
 * Load-time validation. docs/rules-spec.md §3 and §13.
 *
 * §13 is explicit that a violation produces a structured list of errors and
 * nothing is simulated — placements are never silently dropped. Phase 3 feeds
 * this function machine-generated solutions, so the contract has to hold.
 */

import { PLACEABLE, ROTATIONS, type Level, type Solution, type ValidationError } from './types.js'

/** §3. Assembler recipes are unordered pairs; duplicates are a level error. */
export function validateLevel(level: Level): ValidationError[] {
  const errors: ValidationError[] = []
  const seen = new Set<string>()

  for (const recipe of level.recipes.assembler ?? []) {
    const key = [...recipe.in].sort().join('+')
    if (seen.has(key)) {
      errors.push({
        code: 'duplicate_assembler_recipe',
        message: `Assembler recipe for the unordered pair {${recipe.in.join(', ')}} is declared more than once.`,
      })
    }
    seen.add(key)
  }

  return errors
}

export function validateSolution(level: Level, solution: Solution): ValidationError[] {
  const errors: ValidationError[] = []

  if (solution.level_id !== level.id) {
    errors.push({
      code: 'level_id_mismatch',
      message: `Solution targets level "${solution.level_id}" but the level is "${level.id}".`,
    })
  }

  const fixtures = new Set<string>()
  for (const s of [...level.sources, ...level.sinks]) fixtures.add(`${s.pos[0]},${s.pos[1]}`)

  const occupied = new Map<string, number>()

  solution.placements.forEach((placement, index) => {
    const [x, y] = placement.pos
    const key = `${x},${y}`
    const at = { pos: placement.pos, index }

    if (!(PLACEABLE as readonly string[]).includes(placement.type)) {
      errors.push({ code: 'unknown_building_type', message: `Unknown building type "${placement.type}".`, ...at })
      return
    }

    if (!level.available.includes(placement.type)) {
      errors.push({
        code: 'type_not_available',
        message: `"${placement.type}" is not in this level's available list.`,
        ...at,
      })
    }

    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= level.grid.width || y >= level.grid.height) {
      errors.push({ code: 'out_of_bounds', message: `Position (${x}, ${y}) is outside the ${level.grid.width}x${level.grid.height} grid.`, ...at })
      return
    }

    const previous = occupied.get(key)
    if (previous !== undefined) {
      errors.push({
        code: 'overlapping_placement',
        message: `Cell (${x}, ${y}) already holds the placement at index ${previous}; §2 allows at most one building per cell.`,
        ...at,
      })
    } else {
      occupied.set(key, index)
    }

    if (fixtures.has(key)) {
      errors.push({
        code: 'occupied_by_fixture',
        message: `Cell (${x}, ${y}) holds a source or sink, which are fixed by the level and not placeable.`,
        ...at,
      })
    }

    if (placement.type === 'conveyor') {
      // §4 and CLAUDE.md: conveyors are {in, out} pairs, never rotations.
      if (placement.rotation !== undefined) {
        errors.push({ code: 'conveyor_has_rotation', message: `Conveyor at (${x}, ${y}) carries "rotation"; conveyors use "in" and "out".`, ...at })
      }
      if (placement.in === undefined || placement.out === undefined) {
        errors.push({ code: 'conveyor_missing_ports', message: `Conveyor at (${x}, ${y}) needs both "in" and "out".`, ...at })
      } else if (placement.in === placement.out) {
        errors.push({ code: 'conveyor_in_equals_out', message: `Conveyor at (${x}, ${y}) has in === out ("${placement.in}"); §4 requires them to differ.`, ...at })
      }
    } else {
      if (placement.in !== undefined || placement.out !== undefined) {
        errors.push({ code: 'rotated_building_has_ports', message: `"${placement.type}" at (${x}, ${y}) carries "in"/"out"; only conveyors do.`, ...at })
      }
      if (placement.rotation === undefined || !(ROTATIONS as readonly number[]).includes(placement.rotation)) {
        errors.push({ code: 'invalid_rotation', message: `"${placement.type}" at (${x}, ${y}) needs a rotation of 0, 90, 180, or 270.`, ...at })
      }
    }
  })

  return errors
}
