/**
 * The tick. docs/rules-spec.md §6 and §7.
 *
 * The eight phases run in strict order, and the order is not arbitrary:
 * resolving downstream-first is what makes a line of items advance together
 * rather than one cell per tick. Read §6 before changing anything here, and
 * per CLAUDE.md never change the order without updating the affected tests in
 * the same commit.
 */

import { gridOrder } from './geometry.ts'
import {
  assertConservation,
  inNeighbour,
  filterAccepts,
  tryPush,
  type Building,
  type Path,
  type World,
} from './world.ts'
import { DIRECTIONS, type Direction, type ItemType, type Level } from './types.ts'

/**
 * §14 case 10 / CLAUDE.md: the conservation invariant stays asserted
 * permanently in debug builds. Off only where a caller opts out explicitly.
 */
export const CONSERVATION = { enabled: true }

function flip(n: 0 | 1): 0 | 1 {
  return n === 0 ? 1 : 0
}

/** §6 phase 1. Sinks consume; every type is accepted, only the target wins. */
function sinksConsume(world: World): void {
  for (const sink of world.sinks) {
    for (const dir of sink.inPorts) {
      const item = sink.inputs.get(dir) ?? null
      if (item === null) continue
      sink.inputs.set(dir, null)
      world.delivered.set(item, (world.delivered.get(item) ?? 0) + 1)
      world.ledger.delivered += 1
    }
  }
}

/** §6 phase 2. Machines push their output buffer onward; splitters pick per §9. */
function machinesPush(world: World): void {
  for (const m of world.machines) {
    const item = m.output
    if (item === null) continue

    if (m.type === 'splitter') {
      const order: Direction[] = [m.outPorts[m.next], m.outPorts[flip(m.next)]]
      for (const dir of order) {
        if (tryPush(world, m, dir, item)) {
          m.output = null
          m.next = flip(m.next)
          break
        }
      }
      continue
    }

    if (tryPush(world, m, m.outPorts[0], item)) m.output = null
  }
}

/**
 * §7. Tail-first, so cell i+1 is already vacated when cell i is evaluated.
 * This is the whole-train-advances behaviour that §14 case 2 checks.
 */
function resolveLinear(path: Path): void {
  const cells = path.cells
  for (let i = cells.length - 2; i >= 0; i -= 1) {
    const cell = cells[i]
    const next = cells[i + 1]
    if (cell.item !== null && next.item === null) {
      next.item = cell.item
      cell.item = null
    }
  }
}

/**
 * §7 cyclic paths. Start immediately upstream of the lowest-(y,x) empty cell
 * and walk backwards, visiting every cell except the empty one — that is
 * exactly one visit per item, so the loop rotates by one cell per tick. A
 * saturated loop has no gap and does not move: a legal deadlock.
 */
function resolveCyclic(path: Path): void {
  const cells = path.cells
  const n = cells.length

  let gap = -1
  for (let i = 0; i < n; i += 1) {
    if (cells[i].item !== null) continue
    if (gap === -1 || gridOrder(cells[i], cells[gap]) < 0) gap = i
  }
  if (gap === -1) return

  for (let k = 1; k < n; k += 1) {
    const i = (((gap - k) % n) + n) % n
    const cell = cells[i]
    const next = cells[(i + 1) % n]
    if (cell.item !== null && next.item === null) {
      next.item = cell.item
      cell.item = null
    }
  }
}

/** §6 phase 3. Belt resolution moves items between conveyor cells only. */
function beltsAdvance(world: World): void {
  for (const path of world.paths) {
    if (path.cyclic) resolveCyclic(path)
    else resolveLinear(path)
  }
}

/** §6 phase 4. Machines and sinks pull from the conveyor facing each input port. */
function pullInput(world: World): void {
  for (const b of world.buildings) {
    if (b.type === 'conveyor' || b.type === 'source') continue
    for (const dir of DIRECTIONS) {
      if (!b.inPorts.includes(dir)) continue
      if ((b.inputs.get(dir) ?? null) !== null) continue
      const source = inNeighbour(world, b, dir)
      if (!source || source.type !== 'conveyor' || source.item === null) continue
      if (!filterAccepts(world, b, source.item)) continue
      b.inputs.set(dir, source.item)
      source.item = null
    }
  }
}

/** §6 phase 5. A finished job whose output buffer is occupied stays held. */
function finishJobs(world: World): void {
  for (const m of world.machines) {
    if (!m.job || m.job.timer > 0) continue
    if (m.output !== null) continue
    m.output = m.job.product
    m.job = null
    world.ledger.produced += 1
  }
}

function assemblerProduct(level: Level, a: ItemType, b: ItemType): ItemType | null {
  for (const recipe of level.recipes.assembler ?? []) {
    const [x, y] = recipe.in
    if ((x === a && y === b) || (x === b && y === a)) return recipe.out
  }
  return null
}

/** §6 phase 6. Jobs start; splitters and mergers move one item across. */
function startJobsAndTransfer(world: World): void {
  for (const m of world.machines) {
    switch (m.type) {
      case 'press': {
        if (m.job) break
        const dir = m.inPorts[0]
        const item = m.inputs.get(dir) ?? null
        if (item === null) break
        const product = world.level.recipes.press?.[item]
        if (product === undefined) break
        m.inputs.set(dir, null)
        world.ledger.consumed += 1
        m.job = { timer: m.duration, product }
        break
      }
      case 'assembler': {
        if (m.job) break
        const [d0, d1] = m.inPorts
        const a = m.inputs.get(d0) ?? null
        const b = m.inputs.get(d1) ?? null
        if (a === null || b === null) break
        const product = assemblerProduct(world.level, a, b)
        if (product === null) break
        m.inputs.set(d0, null)
        m.inputs.set(d1, null)
        world.ledger.consumed += 2
        m.job = { timer: m.duration, product }
        break
      }
      case 'splitter': {
        if (m.output !== null) break
        const dir = m.inPorts[0]
        const item = m.inputs.get(dir) ?? null
        if (item === null) break
        m.inputs.set(dir, null)
        m.output = item
        break
      }
      case 'merger': {
        if (m.output !== null) break
        const order: Direction[] = [m.inPorts[m.next], m.inPorts[flip(m.next)]]
        for (const dir of order) {
          const item = m.inputs.get(dir) ?? null
          if (item === null) continue
          m.inputs.set(dir, null)
          m.output = item
          m.next = flip(m.next)
          break
        }
        break
      }
    }
  }
}

/**
 * §6 phase 7. Includes a job started in phase 6 of this same tick, and stops
 * at 0 — a finished-but-held job must not drift negative, or a permanently
 * stalled machine never reaches the fixpoint that §13 defines `jammed` by.
 */
function decrementTimers(world: World): void {
  for (const m of world.machines) {
    if (m.job && m.job.timer > 0) m.job.timer -= 1
  }
}

/** §6 phase 8. Same acceptance rule as phase 2 — sources may feed buffers. */
function sourcesEmit(world: World): void {
  for (const source of world.sources) {
    const item = source.emits
    if (item === null || source.outPorts.length === 0) continue
    if (tryPush(world, source, source.outPorts[0], item)) world.ledger.emitted += 1
  }
}

/** One tick, §6's eight phases in strict order. */
export function tick(world: World): void {
  sinksConsume(world)
  machinesPush(world)
  beltsAdvance(world)
  pullInput(world)
  finishJobs(world)
  startJobsAndTransfer(world)
  decrementTimers(world)
  sourcesEmit(world)

  world.tickCount += 1
  if (CONSERVATION.enabled) assertConservation(world)
}

/** §10. Checked after the tick_count increment, win before fail. */
export function hasWon(world: World): boolean {
  return (world.delivered.get(world.level.target.type) ?? 0) >= world.level.target.count
}

export type { Building }
