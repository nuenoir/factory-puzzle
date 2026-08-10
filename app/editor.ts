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

/**
 * Whether the editor should ignore a cell outright for the tool in hand.
 *
 * Sources and sinks are level fixtures (§4): nothing may be built on them and
 * nothing may erase them. It does not follow that a gesture may never *touch*
 * one, and conflating those two is a bug worth naming.
 *
 * §4 connects buildings by mutual facing, so the belt beside a sink has to
 * point at the sink. The only way a drag learns that is by the gesture reaching
 * the sink and standing in as the route's terminus. Refuse the cell outright
 * and the last belt keeps whatever direction the player happened to be walking
 * in — frequently off the edge of the board — and the factory silently fails to
 * deliver with no visible cause. The same goes for a drag leaving a source.
 *
 * So: fixtures are immutable to every tool, and legal endpoints for the belt.
 */
export function ignoresCell(tool: PlaceableType | 'delete', isFixture: boolean): boolean {
  return isFixture && tool !== 'conveyor'
}

export type { PlaceableType }
