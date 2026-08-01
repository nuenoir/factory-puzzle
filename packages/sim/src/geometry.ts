/** Grid and port geometry. docs/rules-spec.md §2 and §4. */

import { DIRECTIONS, type BuildingType, type Direction, type Rotation } from './types'

/** §2. N = y-1, E = x+1, S = y+1, W = x-1. */
export const DELTA: Readonly<Record<Direction, { readonly dx: number; readonly dy: number }>> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
}

export function opposite(d: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + 2) % 4]
}

/** §2. Rotation is clockwise, and DIRECTIONS is in clockwise order. */
export function rotate(d: Direction, r: Rotation): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + r / 90) % 4]
}

/**
 * §4 port geometry at rotation 0.
 *
 * List order is load-bearing: §9 indexes a splitter's two outputs and a
 * merger's two inputs by their position here, and the `next` flag counts
 * against that order. Do not reorder these lists.
 *
 * Conveyors are absent on purpose — they carry an explicit {in, out} pair and
 * are never rotated (§4, and CLAUDE.md's list of things that went wrong once).
 */
const PORTS_AT_ZERO: Readonly<
  Record<Exclude<BuildingType, 'conveyor'>, { readonly in: readonly Direction[]; readonly out: readonly Direction[] }>
> = {
  splitter: { in: ['W'], out: ['N', 'E'] },
  merger: { in: ['W', 'N'], out: ['E'] },
  press: { in: ['W'], out: ['E'] },
  assembler: { in: ['W', 'N'], out: ['E'] },
  source: { in: [], out: ['E'] },
  sink: { in: ['W'], out: [] },
}

export interface Ports {
  readonly in: readonly Direction[]
  readonly out: readonly Direction[]
}

/** Ports of a rotated building, preserving the §9-significant list order. */
export function portsFor(type: Exclude<BuildingType, 'conveyor'>, rotation: Rotation): Ports {
  const base = PORTS_AT_ZERO[type]
  return {
    in: base.in.map((d) => rotate(d, rotation)),
    out: base.out.map((d) => rotate(d, rotation)),
  }
}

/** Ascending (y, x) — the tie-break §6 and §7 use for every ordered sweep. */
export function gridOrder(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.y - b.y || a.x - b.x
}
