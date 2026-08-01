/**
 * Data shapes from docs/rules-spec.md — §12 (level), §13 (solution, result).
 *
 * Nothing here depends on rendering. See CLAUDE.md: this package is both the
 * game engine and the Phase 3 validator, so it stays free of UI imports.
 */

/** §2. Clockwise order — `rotate` depends on it, and §9 indexes ports by it. */
export const DIRECTIONS = ['N', 'E', 'S', 'W'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const ROTATIONS = [0, 90, 180, 270] as const
export type Rotation = (typeof ROTATIONS)[number]

/** Levels and solutions store positions as `[x, y]`; §2, §12. */
export type PosTuple = readonly [number, number]

/** §3. An opaque type string. The engine assigns it no meaning. */
export type ItemType = string

export const PLACEABLE = ['conveyor', 'splitter', 'merger', 'press', 'assembler'] as const
export type PlaceableType = (typeof PLACEABLE)[number]
export type BuildingType = PlaceableType | 'source' | 'sink'

/** §4. Sources and sinks are fixed by the level and cost nothing. */
export const COST: Readonly<Record<PlaceableType, number>> = {
  conveyor: 1,
  splitter: 3,
  merger: 3,
  press: 5,
  assembler: 8,
}

/** §4 "Terminology": a machine is everything placeable except the conveyor. */
export const MACHINES = ['splitter', 'merger', 'press', 'assembler'] as const
export type MachineType = (typeof MACHINES)[number]

/** §4. Overridable per machine type via the level's `durations` field. */
export const DEFAULT_DURATION = 2

export interface AssemblerRecipe {
  readonly in: readonly [ItemType, ItemType]
  readonly out: ItemType
}

export interface Level {
  readonly id: string
  readonly grid: { readonly width: number; readonly height: number }
  readonly sources: ReadonlyArray<{
    readonly pos: PosTuple
    readonly rotation: Rotation
    readonly emits: ItemType
  }>
  readonly sinks: ReadonlyArray<{ readonly pos: PosTuple; readonly rotation: Rotation }>
  readonly target: { readonly type: ItemType; readonly count: number }
  readonly max_ticks: number
  readonly available: readonly PlaceableType[]
  readonly recipes: {
    readonly press?: Readonly<Record<ItemType, ItemType>>
    readonly assembler?: readonly AssemblerRecipe[]
  }
  readonly durations?: { readonly press?: number; readonly assembler?: number }
  readonly par: number
}

/**
 * §13. Deliberately loose: `simulate` must accept malformed solutions and
 * report structured errors rather than crash, so the constraints (conveyors
 * carry {in,out} and never `rotation`, everything else the reverse) are
 * enforced by `validateSolution`, not by the type.
 */
export interface Placement {
  readonly type: PlaceableType
  readonly pos: PosTuple
  readonly in?: Direction
  readonly out?: Direction
  readonly rotation?: Rotation
}

export interface Solution {
  readonly level_id: string
  readonly placements: readonly Placement[]
}

export interface ValidationError {
  readonly code: string
  readonly message: string
  readonly pos?: PosTuple
  /** Index into `solution.placements`, when the error is about one placement. */
  readonly index?: number
}

/** §13. `errors` is empty on a valid run; when non-empty, nothing was simulated. */
export interface SimResult {
  readonly won: boolean
  readonly ticks: number
  readonly cost: number
  readonly footprint: number
  readonly jammed: boolean
  readonly errors: readonly ValidationError[]
}
