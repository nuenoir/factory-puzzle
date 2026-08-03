/**
 * Working out what moved between two ticks, so items slide instead of
 * teleporting.
 *
 * The simulator is discrete and authoritative: one snapshot per tick, knowing
 * nothing about animation. This module is pure presentation — it compares two
 * consecutive snapshots and infers which item went where. It decides nothing;
 * if it inferred wrongly the factory would still run and score identically,
 * only the pixels would lie.
 *
 * Two cases have to come out right, and naive nearest-item matching gets both
 * wrong. A moving train keeps every cell occupied, so matching each item to
 * the nearest one of its type reports the whole line as stationary. And a
 * *jammed* belt looks identical to a moving one under that rule, which would
 * animate flow through a deadlock — actively lying about the thing §8 says
 * must stay visible. So movement is derived from the topology instead, the
 * same way belt resolution does it: an item advances only if the slot ahead
 * genuinely freed up.
 */

import {
  DIRECTIONS,
  neighbourOf,
  opposite,
  type BuildingSnapshot,
  type Direction,
  type ItemType,
  type Snapshot,
} from '@factory/sim'

/**
 * Where an item sits. No direction means the middle of the cell — a conveyor's
 * cargo. A direction means the buffer drawn just inside that edge.
 */
export interface Anchor {
  readonly x: number
  readonly y: number
  readonly dir?: Direction
}

export interface Transit {
  /** Stable within a tick, so React keeps one element while it moves. */
  readonly key: string
  readonly type: ItemType
  /** Null when the item is new — emitted, or produced by a machine. */
  readonly from: Anchor | null
  /** Null when the item left — delivered, or consumed by a machine. */
  readonly to: Anchor | null
}

export const slotKey = (a: Anchor): string => `${a.x},${a.y}${a.dir ? `:${a.dir}` : ''}`

function parseSlot(key: string): Anchor {
  const [cell, dir] = key.split(':')
  const [x, y] = cell.split(',').map(Number)
  return dir === undefined ? { x, y } : { x, y, dir: dir as Direction }
}

/** Every filled slot in a snapshot, keyed by position. */
export function occupancyOf(snapshot: Snapshot): Map<string, ItemType> {
  const filled = new Map<string, ItemType>()
  for (const b of snapshot.buildings) {
    if (b.item !== null) filled.set(slotKey({ x: b.x, y: b.y }), b.item)

    for (const dir of DIRECTIONS) {
      const held = b.inputs[dir]
      if (held !== undefined && held !== null) filled.set(slotKey({ x: b.x, y: b.y, dir }), held)
    }

    if (b.output !== null && b.outPorts.length > 0) {
      filled.set(slotKey({ x: b.x, y: b.y, dir: b.outPorts[0] }), b.output)
    }
  }
  return filled
}

/**
 * How many slots an item can cross in one tick.
 *
 * Two, because §6's phases run in order and an item can be handled twice: a
 * machine pushes it onto a belt in phase 2 and belt resolution advances it
 * again in phase 3; or a belt advances it in phase 3 and a machine pulls it
 * off in phase 4. A line feeding a sink does exactly the latter every tick, so
 * one-hop matching leaves the whole line looking frozen.
 */
const MAX_HOPS = 2

/**
 * Slots a building can hand an item to within one tick, nearest first.
 *
 * Honours §4's mutual-facing rule at every step. A splitter has two outputs
 * and chooses at run time, so both are offered and the caller takes whichever
 * actually received something.
 */
function downstreamSlots(snapshot: Snapshot, b: BuildingSnapshot): Array<{ slot: string; hops: number }> {
  const byCell = new Map(snapshot.buildings.map((n) => [`${n.x},${n.y}`, n]))
  const out: Array<{ slot: string; hops: number }> = []
  const seen = new Set<string>()

  let frontier: BuildingSnapshot[] = [b]
  for (let hop = 1; hop <= MAX_HOPS && frontier.length > 0; hop += 1) {
    const next: BuildingSnapshot[] = []
    for (const node of frontier) {
      for (const dir of node.outPorts) {
        const n = neighbourOf(node.x, node.y, dir)
        const target = byCell.get(`${n.x},${n.y}`)
        if (!target || !target.inPorts.includes(opposite(dir))) continue
        const key =
          target.type === 'conveyor'
            ? slotKey({ x: n.x, y: n.y })
            : slotKey({ x: n.x, y: n.y, dir: opposite(dir) })
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ slot: key, hops: hop })
        next.push(target)
      }
    }
    frontier = next
  }
  return out
}

/**
 * For every building, the slot an item would leave from and the slots it could
 * arrive in. A conveyor hands off its cargo; a machine hands off its output
 * buffer.
 */
function handoffs(snapshot: Snapshot): Array<{ from: string; to: Array<{ slot: string; hops: number }> }> {
  return snapshot.buildings
    .filter((b) => b.type === 'conveyor' || b.outPorts.length > 0)
    .map((b) => ({
      from: b.type === 'conveyor' ? slotKey({ x: b.x, y: b.y }) : slotKey({ x: b.x, y: b.y, dir: b.outPorts[0] }),
      to: downstreamSlots(snapshot, b),
    }))
}

/**
 * Slots whose contents left the board this tick, freeing them for something
 * behind to move up.
 *
 * Without this a saturated belt — the ordinary steady state, every cell full —
 * reads as frozen, because nothing ahead ever looks like it emptied. Two
 * things consume without handing on: a sink swallows whatever is in its buffer
 * at phase 1, every tick, unconditionally; and a machine starting a job eats
 * its inputs.
 */
function consumedSlots(previous: Snapshot, current: Snapshot): Set<string> {
  const freed = new Set<string>()
  const nowById = new Map(current.buildings.map((b) => [`${b.x},${b.y}`, b]))

  for (const b of previous.buildings) {
    if (b.type === 'sink') {
      for (const dir of DIRECTIONS) {
        const held = b.inputs[dir]
        if (held !== undefined && held !== null) freed.add(slotKey({ x: b.x, y: b.y, dir }))
      }
      continue
    }

    // A job that appeared, or one whose timer jumped back up, means fresh
    // inputs were taken out of the buffers on this tick.
    const now = nowById.get(`${b.x},${b.y}`)
    if (!now) continue
    const started = now.job !== null && (b.job === null || now.job.timer > b.job.timer)
    if (!started) continue
    for (const dir of DIRECTIONS) {
      const held = b.inputs[dir]
      if (held !== undefined && held !== null) freed.add(slotKey({ x: b.x, y: b.y, dir }))
    }
  }

  return freed
}

/**
 * Pair up the items in two snapshots.
 *
 * An item advances only when the slot ahead actually took it: it held nothing
 * before, or whatever it held moved on in turn. Resolving that to a fixpoint
 * is what keeps a train sliding together and a jam standing still.
 */
export function deriveTransits(previous: Snapshot | null, current: Snapshot): Transit[] {
  const after = occupancyOf(current)
  if (previous === null) {
    return [...after].map(([key, type]) => ({ key, type, from: null, to: parseSlot(key) }))
  }

  const before = occupancyOf(previous)
  const links = handoffs(previous)
  const vacated = consumedSlots(previous, current)

  // Which slots emptied because their item moved on. Iterated to a fixpoint so
  // a whole line of items advancing together is recognised as one movement.
  const moves = new Map<string, string>()
  const claimed = new Set<string>()

  const sweep = (limit: number): boolean => {
    let progressed = false
    for (const link of links) {
      if (moves.has(link.from)) continue
      const carried = before.get(link.from)
      if (carried === undefined) continue

      for (const { slot: target, hops } of link.to) {
        if (hops > limit) continue
        // The slot ahead must hold this item now, must not already be spoken
        // for, and must have been free — empty already, emptied by its own
        // occupant moving on, or emptied because that occupant left the board.
        if (claimed.has(target)) continue
        if (after.get(target) !== carried) continue
        const wasHeld = before.get(target)
        if (wasHeld !== undefined && !moves.has(target) && !vacated.has(target)) continue
        moves.set(link.from, target)
        claimed.add(target)
        progressed = true
        break
      }
    }
    return progressed
  }

  // Single steps always get first refusal, re-checked every time a slot frees.
  // Reaching two cells ahead is only allowed once no neighbour can take the
  // step — otherwise an item whose neighbour is momentarily blocked leaps past
  // it and strands the one that really moved there. A train shifting one cell
  // is the common case; a two-cell hop is the exception §6 permits when a
  // machine hands over and belt resolution advances the item again.
  for (let working = true; working; ) {
    working = sweep(1) || sweep(MAX_HOPS)
  }

  const transits: Transit[] = []
  const consumedTargets = new Set<string>()

  for (const [from, to] of moves) {
    const type = before.get(from)
    if (type === undefined) continue
    consumedTargets.add(to)
    transits.push({ key: to, type, from: parseSlot(from), to: parseSlot(to) })
  }

  // Anything still in place that did not move is holding station. A slot that
  // was emptied and refilled on the same tick is not holding — those are two
  // different items and both deserve their own beat.
  for (const [key, type] of after) {
    if (consumedTargets.has(key)) continue
    if (before.get(key) === type && !moves.has(key) && !vacated.has(key)) {
      transits.push({ key, type, from: parseSlot(key), to: parseSlot(key) })
    } else {
      transits.push({ key, type, from: null, to: parseSlot(key) })
    }
  }

  // And anything gone from the board was delivered or eaten by a machine —
  // including a slot that something else has already moved into.
  for (const [key, type] of before) {
    if (moves.has(key)) continue
    if (after.has(key) && !consumedTargets.has(key) && !vacated.has(key)) continue
    transits.push({ key: `gone:${key}`, type, from: parseSlot(key), to: null })
  }

  return transits
}

/** Ease-out, so an item settles into a cell rather than stopping dead. */
export function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - (1 - clamped) * (1 - clamped)
}

/** Straight-line interpolation between two points. */
export function lerpPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const e = ease(t)
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }
}

/**
 * The expanding ring drawn when something lands in a sink: it grows outward
 * and fades to nothing by the end of the tick.
 */
export function pulseGeometry(cellWidth: number, t: number): { size: number; opacity: number } {
  const clamped = Math.min(1, Math.max(0, t))
  return { size: cellWidth * (0.45 + clamped * 0.85), opacity: (1 - clamped) * 0.85 }
}

export interface Delivery {
  readonly key: string
  readonly type: ItemType
  readonly at: Anchor
}

/**
 * What was delivered on the tick between these two snapshots, and at which
 * sink.
 *
 * This one needs no guessing. §6 phase 1 consumes *every* filled sink buffer
 * at the top of the tick, so anything sitting in a sink at the end of the
 * previous snapshot was delivered at the start of this one. The global
 * `delivered` counter cannot say which sink it happened at; the buffers can.
 */
export function deliveriesBetween(previous: Snapshot | null, current: Snapshot): Delivery[] {
  if (previous === null) return []
  void current

  const landed: Delivery[] = []
  for (const b of previous.buildings) {
    if (b.type !== 'sink') continue
    for (const dir of DIRECTIONS) {
      const held = b.inputs[dir]
      if (held === undefined || held === null) continue
      landed.push({ key: `${b.x},${b.y}:${dir}`, type: held, at: { x: b.x, y: b.y } })
    }
  }
  return landed
}

/**
 * How far through its job a machine is, 0 to 1, or null when idle.
 *
 * The timer rests at 0 while a finished product waits for somewhere to go
 * (§6 phase 5), so a stalled machine reads as a full ring rather than an empty
 * one — which is the state §8 wants a player to notice.
 */
export function jobProgress(building: BuildingSnapshot, duration: number): number | null {
  if (building.job === null) return null
  if (duration <= 0) return 1
  return Math.min(1, Math.max(0, (duration - building.job.timer) / duration))
}
