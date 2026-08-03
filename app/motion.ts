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
 * The slot a building hands items on to, honouring §4's mutual-facing rule.
 *
 * A splitter has two outputs and picks between them at run time, so it gets
 * both; the caller takes whichever actually received something.
 */
function downstreamSlots(snapshot: Snapshot, b: BuildingSnapshot): string[] {
  const byCell = new Map(snapshot.buildings.map((n) => [`${n.x},${n.y}`, n]))
  const out: string[] = []

  for (const dir of b.outPorts) {
    const n = neighbourOf(b.x, b.y, dir)
    const target = byCell.get(`${n.x},${n.y}`)
    if (!target || !target.inPorts.includes(opposite(dir))) continue
    out.push(target.type === 'conveyor' ? slotKey({ x: n.x, y: n.y }) : slotKey({ x: n.x, y: n.y, dir: opposite(dir) }))
  }
  return out
}

/**
 * For every building, the slot an item would leave from and the slots it could
 * arrive in. A conveyor hands off its cargo; a machine hands off its output
 * buffer.
 */
function handoffs(snapshot: Snapshot): Array<{ from: string; to: string[] }> {
  return snapshot.buildings
    .filter((b) => b.type === 'conveyor' || b.outPorts.length > 0)
    .map((b) => ({
      from: b.type === 'conveyor' ? slotKey({ x: b.x, y: b.y }) : slotKey({ x: b.x, y: b.y, dir: b.outPorts[0] }),
      to: downstreamSlots(snapshot, b),
    }))
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

  // Which slots emptied because their item moved on. Iterated to a fixpoint so
  // a whole line of items advancing together is recognised as one movement.
  const moves = new Map<string, string>()
  for (let changed = true; changed; ) {
    changed = false
    for (const link of links) {
      if (moves.has(link.from)) continue
      const carried = before.get(link.from)
      if (carried === undefined) continue

      for (const target of link.to) {
        // The slot ahead must hold this item now, and must have been free —
        // either empty already, or emptied by its own occupant moving on.
        if (after.get(target) !== carried) continue
        const wasHeld = before.get(target)
        if (wasHeld !== undefined && !moves.has(target)) continue
        if (moves.has(target) && moves.get(target) === link.from) continue
        moves.set(link.from, target)
        changed = true
        break
      }
    }
  }

  const transits: Transit[] = []
  const consumedTargets = new Set<string>()

  for (const [from, to] of moves) {
    const type = before.get(from)
    if (type === undefined) continue
    consumedTargets.add(to)
    transits.push({ key: to, type, from: parseSlot(from), to: parseSlot(to) })
  }

  // Anything still in place that did not move is holding station.
  for (const [key, type] of after) {
    if (consumedTargets.has(key)) continue
    if (before.get(key) === type && !moves.has(key)) {
      transits.push({ key, type, from: parseSlot(key), to: parseSlot(key) })
    } else {
      transits.push({ key, type, from: null, to: parseSlot(key) })
    }
  }

  // And anything gone from the board was delivered or eaten by a machine.
  for (const [key, type] of before) {
    if (moves.has(key)) continue
    if (after.has(key)) continue
    transits.push({ key: `gone:${key}`, type, from: parseSlot(key), to: null })
  }

  return transits
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
