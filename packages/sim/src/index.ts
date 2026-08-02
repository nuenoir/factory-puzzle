/**
 * The headless factory simulator — public surface.
 *
 * `simulate(level, solution)` is the contract in docs/rules-spec.md §13, and
 * the twelve tests it must pass are §14. Beneath it sits a stepping API
 * (`createWorld` + `step` + `snapshot`) because five scalars cannot express
 * per-tick assertions, and Phase 2's animation will need the same view.
 *
 * This package must never import React, Expo, the DOM, or anything from app/.
 * It is both the game engine and the Phase 3 validator; a rendering import
 * here kills headless batch validation and takes Phase 3 with it.
 */

/** The rules-spec version this package implements. Bump only alongside the spec. */
export const SPEC_VERSION = '0.2'

export { simulate, step } from './simulate'
export { tick, hasWon, CONSERVATION } from './tick'
export {
  createWorld,
  snapshot,
  stateKey,
  seedItems,
  clearItems,
  at,
  costOf,
  footprintOf,
  itemsInWorld,
  conservationHolds,
  assertConservation,
  type Building,
  type Path,
  type Snapshot,
  type BuildingSnapshot,
  type Ledger,
  type World,
  type WorldResult,
} from './world'
export { validateLevel, validateSolution } from './validate'
export { neighbourOf, opposite, rotate, portsFor, gridOrder } from './geometry'
export { beltsFromPath, directionBetween, type PathEnds } from './paths'
export {
  COST,
  DIRECTIONS,
  ROTATIONS,
  MACHINES,
  PLACEABLE,
  DEFAULT_DURATION,
  type AssemblerRecipe,
  type BuildingType,
  type Direction,
  type ItemType,
  type Level,
  type MachineType,
  type Placement,
  type PlaceableType,
  type PosTuple,
  type Rotation,
  type SimResult,
  type Solution,
  type ValidationError,
} from './types'
