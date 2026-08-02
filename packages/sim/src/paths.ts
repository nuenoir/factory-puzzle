/**
 * Turning a route across cells into conveyor placements. §2, §4.
 *
 * Belt direction comes from the route rather than a rotation, because a hex
 * conveyor has thirty legal `{in, out}` pairs — far too many to pick from a
 * list. This lives in the simulator package rather than the UI because two
 * very different callers need it and must not disagree: the player's drag
 * gesture, and the Phase 3 router laying belts between machines it placed.
 */

import { neighbourOf, opposite } from './geometry.ts'
import { DIRECTIONS, type Direction, type Placement, type PosTuple } from './types.ts'

/** The direction from `from` to `to`, or null if they are not neighbours. */
export function directionBetween(from: PosTuple, to: PosTuple): Direction | null {
  for (const d of DIRECTIONS) {
    const n = neighbourOf(from[0], from[1], d)
    if (n.x === to[0] && n.y === to[1]) return d
  }
  return null
}

export interface PathEnds {
  /** A building the route starts from — the first belt faces back at it. */
  readonly anchor?: PosTuple | null
  /** A building the route ends at — the last belt points at it. */
  readonly terminus?: PosTuple | null
}

/**
 * Turn a route into conveyors. Each cell takes its `in` from the previous cell
 * and its `out` towards the next.
 *
 * The ends matter as much as the corners. A belt leaving a splitter has to
 * face the splitter, or §4's mutual-facing rule leaves the fork unconnected
 * and it silently does nothing — so the anchor and terminus stand in for the
 * missing neighbours. With neither, an end runs straight through.
 */
export function beltsFromPath(path: readonly PosTuple[], ends: PathEnds = {}): Placement[] {
  if (path.length === 0) return []

  return path.map((pos, i) => {
    const back = i > 0 ? directionBetween(pos, path[i - 1]) : ends.anchor ? directionBetween(pos, ends.anchor) : null
    const forward =
      i < path.length - 1 ? directionBetween(pos, path[i + 1]) : ends.terminus ? directionBetween(pos, ends.terminus) : null
    const inDir: Direction = back ?? (forward ? opposite(forward) : 'W')
    const outDir: Direction = forward ?? (back ? opposite(back) : 'E')
    return { type: 'conveyor', pos, in: inDir, out: outDir }
  })
}
