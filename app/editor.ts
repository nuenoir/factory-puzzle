/**
 * Placement editing. Pure functions over a `Placement[]`, no React.
 *
 * The drag-to-belt geometry itself lives in `@factory/sim` (`paths.ts`): the
 * Phase 3 router lays belts between machines the same way, and the two must
 * not drift apart. This module is the editing model layered on top of it.
 */

import {
  beltsFromPath,
  directionBetween,
  type Placement,
  type PlaceableType,
  type PosTuple,
  type Rotation,
} from '@factory/sim'

export { beltsFromPath, directionBetween }
export type { PathEnds } from '@factory/sim'

const samePos = (a: PosTuple, b: PosTuple) => a[0] === b[0] && a[1] === b[1]

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
