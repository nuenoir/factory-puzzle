/**
 * Placement editing. Pure functions over a `Placement[]`, no React.
 *
 * Belt direction comes from the drag path rather than a rotation, because a
 * hex conveyor has thirty legal `{in, out}` pairs (§4) — far too many to pick
 * from a menu. Dragging expresses the route directly, and the corners fall out
 * of it.
 *
 * Adjacency is resolved with the simulator's own `neighbourOf`, so the editor
 * and the engine can never disagree about what counts as a neighbour.
 */

import {
  DIRECTIONS,
  neighbourOf,
  opposite,
  type Direction,
  type Placement,
  type PlaceableType,
  type PosTuple,
  type Rotation,
} from '@factory/sim'

const samePos = (a: PosTuple, b: PosTuple) => a[0] === b[0] && a[1] === b[1]

/** The direction from `from` to `to`, or null if they are not neighbours. */
export function directionBetween(from: PosTuple, to: PosTuple): Direction | null {
  for (const d of DIRECTIONS) {
    const n = neighbourOf(from[0], from[1], d)
    if (n.x === to[0] && n.y === to[1]) return d
  }
  return null
}

export interface PathEnds {
  /** A building the drag started from — the first belt faces back at it. */
  readonly anchor?: PosTuple | null
  /** A building the drag ran into — the last belt points at it. */
  readonly terminus?: PosTuple | null
}

/**
 * Turn a dragged path into conveyors. Each cell takes its `in` from the
 * previous cell and its `out` towards the next.
 *
 * The ends matter as much as the corners. Dragging out of a splitter has to
 * produce a belt whose `in` faces the splitter, or §4's mutual-facing rule
 * leaves it unconnected and the fork silently does nothing — so the anchor and
 * terminus stand in for the missing neighbours. With neither, an end runs
 * straight through.
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

export type EditAction =
  | { readonly kind: 'place'; readonly placement: Placement }
  | { readonly kind: 'placeMany'; readonly placements: readonly Placement[] }
  | { readonly kind: 'remove'; readonly pos: PosTuple }
  | { readonly kind: 'rotate'; readonly pos: PosTuple }
  | { readonly kind: 'clear' }

/** A placement always replaces whatever occupied the cell — §2 allows one. */
export function editReducer(state: readonly Placement[], action: EditAction): Placement[] {
  switch (action.kind) {
    case 'place':
      return [...state.filter((p) => !samePos(p.pos, action.placement.pos)), action.placement]

    case 'placeMany': {
      const taken = action.placements.map((p) => p.pos)
      return [...state.filter((p) => !taken.some((pos) => samePos(pos, p.pos))), ...action.placements]
    }

    case 'remove':
      return state.filter((p) => !samePos(p.pos, action.pos))

    case 'rotate':
      return state.map((p) =>
        samePos(p.pos, action.pos) && p.rotation !== undefined
          ? { ...p, rotation: ((p.rotation + 60) % 360) as Rotation }
          : p,
      )

    case 'clear':
      return []
  }
}

export function placementAt(placements: readonly Placement[], pos: PosTuple): Placement | undefined {
  return placements.find((p) => samePos(p.pos, pos))
}

export type { PlaceableType }
