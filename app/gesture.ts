/**
 * What a touch on the board does. Pure, so it can be replayed without a screen.
 *
 * This used to live inside the component, which is why the worst bug in the
 * project shipped: a blanket guard stopped a drag ever touching a source or
 * sink, so the belt beside the sink kept whatever direction the drag was
 * walking in instead of turning to face it. §4 connects buildings by mutual
 * facing, so the factory built, ran, produced its items and delivered none —
 * silently, on four levels in five. Nothing could test it, because it was
 * seventy lines of stateful logic wrapped in a `useCallback`.
 *
 * Out here a whole gesture is a list of events and the result is a list of
 * placements, which a simulator can be asked to run.
 */

import { beltsFromPath, directionBetween, type Placement, type PosTuple } from '@factory/sim'

import { ignoresCell, placementAt, type EditAction, type PlaceableType } from './editor'

export type GesturePhase = 'down' | 'move' | 'up'

/** A belt route under construction. */
export interface Drag {
  readonly path: readonly PosTuple[]
  /** A building the route started from; the first belt faces back at it. */
  readonly anchor: PosTuple | null
  /** A building the route ended at. Set means the route is finished. */
  readonly terminus: PosTuple | null
}

export interface Context {
  readonly tool: PlaceableType | 'delete'
  readonly rotation: Placement['rotation']
  readonly placements: readonly Placement[]
  readonly drag: Drag | null
  /** Sources and sinks: immutable, but legal endpoints for a belt. */
  readonly isFixture: (pos: PosTuple) => boolean
}

export interface Outcome {
  /** The drag after this event: `null` clears it. */
  readonly drag: Drag | null
  /** Edits to apply, in order. Usually none or one. */
  readonly actions: readonly EditAction[]
}

const at = (a: PosTuple, b: PosTuple) => a[0] === b[0] && a[1] === b[1]

/**
 * One pointer event on one cell.
 *
 * `drag` is threaded through rather than mutated, so a caller can replay a
 * gesture, fork it, or assert on any intermediate state.
 */
export function onCell(phase: GesturePhase, pos: PosTuple, context: Context): Outcome {
  const { tool, rotation, placements, drag, isFixture } = context

  if (phase === 'up') return { drag: null, actions: [] }

  const fixture = isFixture(pos)
  if (ignoresCell(tool, fixture)) return { drag, actions: [] }

  if (tool === 'delete') return { drag, actions: [{ kind: 'remove', pos }] }

  if (tool !== 'conveyor') {
    // Machines: tap empty ground to place, tap your own building to turn it.
    if (phase !== 'down') return { drag, actions: [] }
    const existing = placementAt(placements, pos)
    return existing && existing.type === tool
      ? { drag, actions: [{ kind: 'rotate', pos }] }
      : { drag, actions: [{ kind: 'place', placement: { type: tool, pos, rotation } }] }
  }

  // A cell holding a machine or a fixture cannot become a belt, but it can
  // bookend one: leave a splitter and the first belt faces back at it; run into
  // a sink and the last belt points at it.
  const occupant = placementAt(placements, pos)
  const isBuilding = fixture || (occupant !== undefined && occupant.type !== 'conveyor')

  if (phase === 'down') {
    return isBuilding
      ? { drag: { path: [], anchor: pos, terminus: null }, actions: [] }
      : {
          drag: { path: [pos], anchor: null, terminus: null },
          actions: [{ kind: 'placeMany', placements: beltsFromPath([pos]) }],
        }
  }

  if (drag === null || drag.terminus !== null) return { drag, actions: [] }
  const ends = { anchor: drag.anchor, terminus: null }

  const last = drag.path.length > 0 ? drag.path[drag.path.length - 1] : drag.anchor
  if (last === null || at(last, pos)) return { drag, actions: [] }

  if (isBuilding) {
    if (drag.path.length === 0) return { drag, actions: [] }
    if (!directionBetween(last, pos)) return { drag, actions: [] }
    return {
      drag: { ...drag, terminus: pos },
      actions: [{ kind: 'placeMany', placements: beltsFromPath(drag.path, { ...ends, terminus: pos }) }],
    }
  }

  // Dragging back onto the previous cell undoes the last step.
  const previous = drag.path.length >= 2 ? drag.path[drag.path.length - 2] : null
  if (previous && at(previous, pos)) {
    const path = drag.path.slice(0, -1)
    return { drag: { ...drag, path }, actions: [{ kind: 'placeMany', placements: beltsFromPath(path, ends) }] }
  }

  // Ignore jumps from a fast drag, and self-crossings: a conveyor has one in
  // and one out, so a route may not visit a cell twice.
  if (!directionBetween(last, pos)) return { drag, actions: [] }
  if (drag.path.some((p) => at(p, pos))) return { drag, actions: [] }

  const path = [...drag.path, pos]
  return { drag: { ...drag, path }, actions: [{ kind: 'placeMany', placements: beltsFromPath(path, ends) }] }
}
