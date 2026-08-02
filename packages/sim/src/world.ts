/**
 * World state, construction, and the queries the tick phases run on.
 * docs/rules-spec.md §2, §4, §5, §7.
 */

import { gridOrder, opposite, portsFor } from './geometry'
import { validateLevel, validateSolution } from './validate'
import {
  COST,
  DEFAULT_DURATION,
  DIRECTIONS,
  type BuildingType,
  type Direction,
  type ItemType,
  type Level,
  type PlaceableType,
  type PosTuple,
  type Solution,
  type ValidationError,
} from './types'

export interface Job {
  timer: number
  readonly product: ItemType
}

export interface Building {
  readonly type: BuildingType
  readonly x: number
  readonly y: number
  readonly inPorts: readonly Direction[]
  readonly outPorts: readonly Direction[]
  /** Source only. */
  readonly emits: ItemType | null
  /** Press and assembler only; §4. */
  readonly duration: number
  /** Conveyor cargo. Conveyors have no buffers (§5) — the cell holds the item. */
  item: ItemType | null
  /** Machine and sink input buffers, capacity 1 each, keyed by port direction (§5). */
  readonly inputs: Map<Direction, ItemType | null>
  /** One capacity-1 output buffer per machine, shared across output ports (§5). */
  output: ItemType | null
  job: Job | null
  /** §9. Index into the two-port list; the lists in geometry.ts define the order. */
  next: 0 | 1
}

/** §7. A maximal chain of mutually connected conveyors. */
export interface Path {
  readonly cells: readonly Building[]
  readonly cyclic: boolean
}

export interface Ledger {
  /** Source emissions (§6 phase 8). */
  emitted: number
  /** Items placed into output buffers by §6 phase 5. */
  produced: number
  /** Items removed from input buffers at job start, §6 phase 6. */
  consumed: number
  /** Phase-1 sink consumptions, summed across all types. */
  delivered: number
  /** Items placed by the test API (`seedItems`). Zero in normal play. */
  seeded: number
  /** Items removed by the test API (`clearItems`). Zero in normal play. */
  removed: number
}

export interface World {
  readonly level: Level
  readonly width: number
  readonly height: number
  /** Flat, indexed `y * width + x`. */
  readonly cells: ReadonlyArray<Building | null>
  /** Every building, in ascending (y, x) — the sweep order §6 mandates. */
  readonly buildings: readonly Building[]
  readonly sources: readonly Building[]
  readonly sinks: readonly Building[]
  readonly machines: readonly Building[]
  readonly paths: readonly Path[]
  readonly delivered: Map<ItemType, number>
  tickCount: number
  readonly ledger: Ledger
}

export type WorldResult =
  | { readonly ok: true; readonly world: World }
  | { readonly ok: false; readonly errors: readonly ValidationError[] }

export function at(world: World, x: number, y: number): Building | null {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null
  return world.cells[y * world.width + x]
}

function neighbour(world: World, b: Building, dir: Direction): Building | null {
  const d = dir === 'N' ? { dx: 0, dy: -1 } : dir === 'E' ? { dx: 1, dy: 0 } : dir === 'S' ? { dx: 0, dy: 1 } : { dx: -1, dy: 0 }
  return at(world, b.x + d.dx, b.y + d.dy)
}

/**
 * §4. A connection exists only if `b`'s output port faces the neighbour AND
 * the neighbour's input port faces back. No implicit adjacency transfer.
 */
export function outNeighbour(world: World, b: Building, dir: Direction): Building | null {
  if (!b.outPorts.includes(dir)) return null
  const other = neighbour(world, b, dir)
  if (!other || !other.inPorts.includes(opposite(dir))) return null
  return other
}

/** The mirror of `outNeighbour`: who feeds `b` through its `dir` input port. */
export function inNeighbour(world: World, b: Building, dir: Direction): Building | null {
  if (!b.inPorts.includes(dir)) return null
  const other = neighbour(world, b, dir)
  if (!other || !other.outPorts.includes(opposite(dir))) return null
  return other
}

/**
 * §8 input filters. A press takes only types its recipe table keys; an
 * assembler only types appearing in some recipe's `in` list (outputs do not
 * count). Splitters, mergers, and sinks have no filter.
 */
export function filterAccepts(world: World, b: Building, item: ItemType): boolean {
  if (b.type === 'press') {
    const table = world.level.recipes.press
    return table !== undefined && Object.prototype.hasOwnProperty.call(table, item)
  }
  if (b.type === 'assembler') {
    return (world.level.recipes.assembler ?? []).some((r) => r.in.includes(item))
  }
  return true
}

/**
 * Can `target` take `item` arriving through its `viaDir` input port?
 * The acceptance list is shared by §6 phases 2 and 8.
 */
export function accepts(world: World, target: Building, viaDir: Direction, item: ItemType): boolean {
  if (target.type === 'conveyor') return target.item === null
  if (!target.inPorts.includes(viaDir)) return false
  if ((target.inputs.get(viaDir) ?? null) !== null) return false
  return filterAccepts(world, target, item)
}

/** Move `item` out of a building and into the cell its `dir` port faces. */
export function tryPush(world: World, from: Building, dir: Direction, item: ItemType): boolean {
  const target = outNeighbour(world, from, dir)
  if (!target) return false
  const viaDir = opposite(dir)
  if (!accepts(world, target, viaDir, item)) return false
  if (target.type === 'conveyor') target.item = item
  else target.inputs.set(viaDir, item)
  return true
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function makeBuilding(
  type: BuildingType,
  x: number,
  y: number,
  ports: { in: readonly Direction[]; out: readonly Direction[] },
  extras: { emits?: ItemType; duration?: number },
): Building {
  const inputs = new Map<Direction, ItemType | null>()
  for (const d of ports.in) inputs.set(d, null)
  return {
    type,
    x,
    y,
    inPorts: ports.in,
    outPorts: ports.out,
    emits: extras.emits ?? null,
    duration: extras.duration ?? DEFAULT_DURATION,
    item: null,
    inputs,
    output: null,
    job: null,
    next: 0,
  }
}

export function createWorld(level: Level, solution: Solution): WorldResult {
  const errors = [...validateLevel(level), ...validateSolution(level, solution)]
  if (errors.length > 0) return { ok: false, errors }

  const { width, height } = level.grid
  const cells: (Building | null)[] = new Array<Building | null>(width * height).fill(null)
  const put = (b: Building) => {
    cells[b.y * width + b.x] = b
  }

  for (const s of level.sources) {
    put(makeBuilding('source', s.pos[0], s.pos[1], portsFor('source', s.rotation), { emits: s.emits }))
  }
  for (const s of level.sinks) {
    put(makeBuilding('sink', s.pos[0], s.pos[1], portsFor('sink', s.rotation), {}))
  }
  for (const p of solution.placements) {
    const [x, y] = p.pos
    if (p.type === 'conveyor') {
      // Validated above, so both ports are present and differ.
      put(makeBuilding('conveyor', x, y, { in: [p.in as Direction], out: [p.out as Direction] }, {}))
    } else {
      const duration = p.type === 'press' ? level.durations?.press : p.type === 'assembler' ? level.durations?.assembler : undefined
      put(makeBuilding(p.type, x, y, portsFor(p.type, p.rotation ?? 0), { duration }))
    }
  }

  const buildings = cells.filter((b): b is Building => b !== null).sort(gridOrder)
  const world: World = {
    level,
    width,
    height,
    cells,
    buildings,
    sources: buildings.filter((b) => b.type === 'source'),
    sinks: buildings.filter((b) => b.type === 'sink'),
    machines: buildings.filter((b) => b.type !== 'source' && b.type !== 'sink' && b.type !== 'conveyor'),
    paths: [],
    delivered: new Map<ItemType, number>(),
    tickCount: 0,
    ledger: { emitted: 0, produced: 0, consumed: 0, delivered: 0, seeded: 0, removed: 0 },
  }
  ;(world as { paths: readonly Path[] }).paths = computePaths(world, buildings)
  return { ok: true, world }
}

/**
 * §7. Paths are maximal chains of mutually connected conveyors. The building a
 * path's tail faces is not a member — transfer into it happens in phases 2 and
 * 4, never in phase 3.
 */
function computePaths(world: World, buildings: readonly Building[]): Path[] {
  const conveyors = buildings.filter((b) => b.type === 'conveyor')

  const successor = (c: Building): Building | null => {
    const next = outNeighbour(world, c, c.outPorts[0])
    return next && next.type === 'conveyor' ? next : null
  }
  const predecessor = (c: Building): Building | null => {
    const prev = inNeighbour(world, c, c.inPorts[0])
    return prev && prev.type === 'conveyor' ? prev : null
  }

  const linear: Path[] = []
  const cyclic: Path[] = []
  const seen = new Set<Building>()

  for (const head of conveyors) {
    if (predecessor(head) !== null || seen.has(head)) continue
    const cells: Building[] = []
    for (let c: Building | null = head; c !== null && !seen.has(c); c = successor(c)) {
      seen.add(c)
      cells.push(c)
    }
    linear.push({ cells, cyclic: false })
  }

  // Whatever is left has a predecessor and was never reached from a head: a loop.
  for (const start of conveyors) {
    if (seen.has(start)) continue
    const cells: Building[] = []
    for (let c: Building | null = start; c !== null && !seen.has(c); c = successor(c)) {
      seen.add(c)
      cells.push(c)
    }
    cyclic.push({ cells, cyclic: true })
  }

  // §7 path ordering: linear by input-end cell, then cyclic by lowest cell.
  linear.sort((a, b) => gridOrder(a.cells[0], b.cells[0]))
  const lowest = (p: Path) => [...p.cells].sort(gridOrder)[0]
  cyclic.sort((a, b) => gridOrder(lowest(a), lowest(b)))
  return [...linear, ...cyclic]
}

// ---------------------------------------------------------------------------
// Scoring, snapshots, conservation
// ---------------------------------------------------------------------------

/** §11. Sum of the §4 cost column — not a building count. */
export function costOf(solution: Solution): number {
  return solution.placements.reduce((sum, p) => sum + (COST[p.type as PlaceableType] ?? 0), 0)
}

/** §11. Area of the bounding box of player-placed buildings; 0 when empty. */
export function footprintOf(solution: Solution): number {
  if (solution.placements.length === 0) return 0
  const xs = solution.placements.map((p) => p.pos[0])
  const ys = solution.placements.map((p) => p.pos[1])
  return (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)
}

/**
 * §13/§14. Put items directly on conveyor cells to build states unreachable
 * from an empty start — §14 cases 2 and 9 need exactly this.
 *
 * Seeded and cleared items get their own ledger terms so `emitted` and
 * `delivered` keep their documented meanings (source emissions, sink
 * consumptions) even inside tests.
 */
export function seedItems(world: World, entries: ReadonlyArray<{ pos: PosTuple; item: ItemType }>): void {
  for (const { pos, item } of entries) {
    const cell = at(world, pos[0], pos[1])
    if (!cell || cell.type !== 'conveyor') {
      throw new Error(`seedItems: (${pos[0]}, ${pos[1]}) is not a conveyor cell.`)
    }
    if (cell.item !== null) throw new Error(`seedItems: (${pos[0]}, ${pos[1]}) already holds an item.`)
    cell.item = item
    world.ledger.seeded += 1
  }
}

/** The inverse of `seedItems`; see its note on ledger accounting. */
export function clearItems(world: World, positions: readonly PosTuple[]): void {
  for (const pos of positions) {
    const cell = at(world, pos[0], pos[1])
    if (!cell || cell.type !== 'conveyor') {
      throw new Error(`clearItems: (${pos[0]}, ${pos[1]}) is not a conveyor cell.`)
    }
    if (cell.item === null) continue
    cell.item = null
    world.ledger.removed += 1
  }
}

export interface BuildingSnapshot {
  readonly type: BuildingType
  readonly x: number
  readonly y: number
  /** Static geometry, repeated here so a snapshot alone is enough to render. */
  readonly inPorts: readonly Direction[]
  readonly outPorts: readonly Direction[]
  /** Source only. */
  readonly emits: ItemType | null
  readonly item: ItemType | null
  readonly inputs: Readonly<Record<string, ItemType | null>>
  readonly output: ItemType | null
  readonly job: { readonly timer: number; readonly product: ItemType } | null
  readonly next: 0 | 1
}

export interface Snapshot {
  readonly tick: number
  readonly delivered: Readonly<Record<ItemType, number>>
  readonly ledger: Readonly<Ledger>
  readonly buildings: readonly BuildingSnapshot[]
}

/** §13. A serialisable read-only view; the tests assert against this. */
export function snapshot(world: World): Snapshot {
  const delivered: Record<ItemType, number> = {}
  for (const key of [...world.delivered.keys()].sort()) delivered[key] = world.delivered.get(key) ?? 0

  return {
    tick: world.tickCount,
    delivered,
    ledger: { ...world.ledger },
    buildings: world.buildings.map((b) => {
      const inputs: Record<string, ItemType | null> = {}
      for (const d of DIRECTIONS) if (b.inPorts.includes(d)) inputs[d] = b.inputs.get(d) ?? null
      return {
        type: b.type,
        x: b.x,
        y: b.y,
        inPorts: b.inPorts,
        outPorts: b.outPorts,
        emits: b.emits,
        item: b.item,
        inputs,
        output: b.output,
        job: b.job ? { timer: b.job.timer, product: b.job.product } : null,
        next: b.next,
      }
    }),
  }
}

/** §13. Everything but the tick number — equal keys means a fixpoint. */
export function stateKey(world: World): string {
  const { tick: _tick, ...rest } = snapshot(world)
  return JSON.stringify(rest)
}

/** §14 case 10. Conveyor cargo plus every input, output, and sink buffer. */
export function itemsInWorld(world: World): number {
  let count = 0
  for (const b of world.buildings) {
    if (b.item !== null) count += 1
    for (const d of b.inPorts) if ((b.inputs.get(d) ?? null) !== null) count += 1
    if (b.output !== null) count += 1
  }
  return count
}

/**
 * §14 case 10, the gross ledger. Items inside a running job are counted in
 * `consumed` and are deliberately not in `itemsInWorld`. The test API's
 * `seeded`/`removed` terms are zero in normal play, where this reduces to the
 * §14 equation exactly.
 */
export function conservationHolds(world: World): boolean {
  const { emitted, produced, consumed, delivered, seeded, removed } = world.ledger
  return emitted + seeded + produced === itemsInWorld(world) + delivered + removed + consumed
}

export function assertConservation(world: World): void {
  if (conservationHolds(world)) return
  const { emitted, produced, consumed, delivered, seeded, removed } = world.ledger
  throw new Error(
    `Item conservation violated at tick ${world.tickCount}: ` +
      `emitted(${emitted}) + seeded(${seeded}) + produced(${produced}) !== ` +
      `in_world(${itemsInWorld(world)}) + delivered(${delivered}) + removed(${removed}) + consumed(${consumed})`,
  )
}
