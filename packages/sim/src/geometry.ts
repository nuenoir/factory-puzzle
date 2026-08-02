/** Hex grid and port geometry. docs/rules-spec.md §2 and §4. */

import { DIRECTIONS, type BuildingType, type Direction, type Rotation } from './types'

/**
 * §2. Pointy-top hexes in odd-r offset coordinates: odd rows sit half a cell
 * to the right, so a neighbour's offset depends on the row's parity. `E` and
 * `W` are row-aligned on every row, which is what keeps a west-to-east line
 * straight.
 */
const EVEN_ROW: Readonly<Record<Direction, readonly [number, number]>> = {
  E: [1, 0],
  SE: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
  NE: [0, -1],
}

const ODD_ROW: Readonly<Record<Direction, readonly [number, number]>> = {
  E: [1, 0],
  SE: [1, 1],
  SW: [0, 1],
  W: [-1, 0],
  NW: [0, -1],
  NE: [1, -1],
}

/** The cell `dir` leads to from `(x, y)`. Bounds are the caller's problem. */
export function neighbourOf(x: number, y: number, dir: Direction): { x: number; y: number } {
  const [dx, dy] = (y % 2 === 0 ? EVEN_ROW : ODD_ROW)[dir]
  return { x: x + dx, y: y + dy }
}

/** §2. Three steps around the clockwise list: E↔W, SE↔NW, SW↔NE. */
export function opposite(d: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + 3) % 6]
}

/** §2. Rotation is clockwise in 60° steps, and DIRECTIONS is clockwise. */
export function rotate(d: Direction, r: Rotation): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + r / 60) % 6]
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
  splitter: { in: ['W'], out: ['NE', 'SE'] },
  merger: { in: ['NW', 'SW'], out: ['E'] },
  press: { in: ['W'], out: ['E'] },
  assembler: { in: ['W', 'NW'], out: ['E'] },
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
