/**
 * Belt routing between two ports. docs/generation-spec.md §4 stage C.
 *
 * A breadth-first search over free cells, converted to conveyors by the
 * simulator's own `beltsFromPath` — the same function the player's drag uses,
 * so a routed line and a hand-drawn one are built by identical rules.
 *
 * The router is only ever a heuristic. It answers "is there a lane" and lays
 * belts down it; whether the result actually delivers is `simulate`'s call and
 * nobody else's (CLAUDE.md).
 */

import {
  DIRECTIONS,
  beltsFromPath,
  neighbourOf,
  type Direction,
  type Placement,
  type PosTuple,
} from '@factory/sim'

export interface PortRef {
  /** The building's own cell. */
  readonly pos: PosTuple
  /** The port direction, as seen from that building. */
  readonly dir: Direction
}

export interface Grid {
  readonly width: number
  readonly height: number
}

const key = (x: number, y: number) => `${x},${y}`

function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height
}

/**
 * Belts connecting `from`'s output port to `to`'s input port, or null when no
 * lane exists. An empty array means the two buildings already touch and their
 * ports face each other, so no belt is needed at all.
 *
 * `occupied` holds every cell already spoken for, including the two buildings.
 */
export function routeBelts(
  grid: Grid,
  occupied: ReadonlySet<string>,
  from: PortRef,
  to: PortRef,
): Placement[] | null {
  const exit = neighbourOf(from.pos[0], from.pos[1], from.dir)
  const entry = neighbourOf(to.pos[0], to.pos[1], to.dir)

  // Already touching, ports facing: §4 says that is a connection on its own.
  if (exit.x === to.pos[0] && exit.y === to.pos[1] && entry.x === from.pos[0] && entry.y === from.pos[1]) {
    return []
  }

  const free = (x: number, y: number) => inBounds(grid, x, y) && !occupied.has(key(x, y))
  if (!free(exit.x, exit.y) || !free(entry.x, entry.y)) return null

  const ends = { anchor: from.pos, terminus: to.pos }
  if (exit.x === entry.x && exit.y === entry.y) {
    return beltsFromPath([[exit.x, exit.y]], ends)
  }

  const path = shortestPath(grid, occupied, [exit.x, exit.y], [entry.x, entry.y])
  return path === null ? null : beltsFromPath(path, ends)
}

/**
 * Breadth-first, so the first route found is a shortest one — fewest belts,
 * which is also cheapest since every conveyor costs the same (§4).
 *
 * Neighbours are visited in the fixed §2 direction order, so the chosen route
 * is deterministic. §7 requires the whole batch to reproduce from its seed,
 * and a router that broke ties by hash order would quietly break that.
 */
function shortestPath(
  grid: Grid,
  occupied: ReadonlySet<string>,
  start: PosTuple,
  goal: PosTuple,
): PosTuple[] | null {
  const goalKey = key(goal[0], goal[1])
  const cameFrom = new Map<string, string | null>([[key(start[0], start[1]), null]])
  const queue: PosTuple[] = [start]

  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head]
    if (key(x, y) === goalKey) return reconstruct(cameFrom, goalKey)

    for (const d of DIRECTIONS) {
      const n = neighbourOf(x, y, d)
      const nKey = key(n.x, n.y)
      if (!inBounds(grid, n.x, n.y)) continue
      if (occupied.has(nKey) || cameFrom.has(nKey)) continue
      cameFrom.set(nKey, key(x, y))
      queue.push([n.x, n.y])
    }
  }

  return null
}

function reconstruct(cameFrom: ReadonlyMap<string, string | null>, goalKey: string): PosTuple[] {
  const path: PosTuple[] = []
  for (let at: string | null | undefined = goalKey; at != null; at = cameFrom.get(at)) {
    const [x, y] = at.split(',').map(Number)
    path.push([x, y])
  }
  return path.reverse()
}
