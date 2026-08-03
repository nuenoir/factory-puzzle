/**
 * Deriving movement between two ticks.
 *
 * The two failure modes that matter are a moving train rendering as
 * stationary, and — much worse — a jammed belt rendering as flowing. The
 * second would animate motion through a deadlock, hiding the very thing the
 * spec insists a player must be able to see. Snapshots come from the real
 * simulator, so these are tested against what the engine actually produces.
 */

import { describe, expect, it } from 'vitest'
import { createWorld, seedItems, snapshot, step, type Level, type Placement, type Snapshot } from '@factory/sim'

import {
  deliveriesBetween,
  deriveTransits,
  ease,
  jobProgress,
  lerpPoint,
  occupancyOf,
  pulseGeometry,
  slotKey,
} from './motion'

function build(level: Level, placements: Placement[]) {
  const made = createWorld(level, { level_id: level.id, placements })
  if (!made.ok) throw new Error(made.errors.map((e) => e.message).join('\n'))
  return made.world
}

const baseLevel = (overrides: Partial<Level> = {}): Level => ({
  id: 'motion-test',
  grid: { width: 7, height: 7 },
  sources: [],
  sinks: [],
  target: { type: 'widget', count: 5 },
  max_ticks: 300,
  available: ['conveyor', 'splitter', 'press', 'assembler'],
  recipes: {},
  par: 0,
  ...overrides,
})

const belts = (x: number, y: number, n: number): Placement[] =>
  Array.from({ length: n }, (_, i) => ({ type: 'conveyor', pos: [x + i, y], in: 'W', out: 'E' }))

const moved = (t: ReturnType<typeof deriveTransits>[number]) =>
  t.from !== null && t.to !== null && slotKey(t.from) !== slotKey(t.to)

describe('occupancyOf', () => {
  it('finds cargo on belts and items in buffers', () => {
    const level = baseLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      recipes: { press: { circle: 'disc' } },
    })
    const world = build(level, [{ type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' }, { type: 'press', pos: [2, 3], rotation: 0 }])
    for (let i = 0; i < 3; i += 1) step(world)

    const filled = occupancyOf(snapshot(world))
    // Something on the belt, and something in the press's west input buffer.
    expect(filled.size).toBeGreaterThan(0)
    expect([...filled.keys()].some((k) => k.includes(':'))).toBe(true)
  })
})

describe('a moving train', () => {
  it('slides every item forward rather than reporting them all as held', () => {
    const world = build(baseLevel(), belts(0, 0, 6))
    // Identical types on purpose: this is the case where matching an item to
    // the nearest one of its kind would call the whole line stationary.
    seedItems(world, [0, 1, 2, 3, 4].map((x) => ({ pos: [x, 0] as [number, number], item: 'ore' })))

    const before = snapshot(world)
    step(world)
    const transits = deriveTransits(before, snapshot(world))

    const movers = transits.filter(moved)
    expect(movers).toHaveLength(5)
    for (const t of movers) {
      expect(t.to!.x).toBe(t.from!.x + 1)
      expect(t.to!.y).toBe(t.from!.y)
    }
  })
})

describe('a jammed belt', () => {
  it('shows nothing moving, so a deadlock never looks like flow', () => {
    // A dead-end run, filled solid. Nothing can advance.
    const world = build(baseLevel(), belts(0, 0, 4))
    seedItems(world, [0, 1, 2, 3].map((x) => ({ pos: [x, 0] as [number, number], item: 'ore' })))

    const before = snapshot(world)
    step(world)
    const transits = deriveTransits(before, snapshot(world))

    expect(transits.filter(moved)).toHaveLength(0)
    expect(transits).toHaveLength(4)
    for (const t of transits) expect(slotKey(t.from!)).toBe(slotKey(t.to!))
  })

  it('still shows the front of a partly blocked line moving', () => {
    // Gap at the front only: the leading item advances, the rest cannot.
    const world = build(baseLevel(), belts(0, 0, 5))
    seedItems(world, [0, 1, 2].map((x) => ({ pos: [x, 0] as [number, number], item: 'ore' })))

    const before = snapshot(world)
    step(world)
    const transits = deriveTransits(before, snapshot(world))
    // All three can shuffle forward, because each vacates in turn.
    expect(transits.filter(moved).length).toBeGreaterThan(0)
  })
})

describe('items entering and leaving', () => {
  it('fades in an emitted item rather than sliding it from nowhere', () => {
    const level = baseLevel({ sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }] })
    const world = build(level, belts(1, 3, 2))

    const before = snapshot(world)
    step(world)
    const transits = deriveTransits(before, snapshot(world))

    const arrival = transits.find((t) => t.to !== null && t.to.x === 1 && t.to.y === 3)
    expect(arrival?.from).toBeNull()
  })

  it('fades out a delivered item', () => {
    // No source, one seeded item: the sink consumes it and nothing refills the
    // buffer, so the disappearance is unambiguous. With a source running, the
    // buffer is emptied and refilled on the same tick and the two items are
    // indistinguishable — which is invisible on screen and not worth chasing.
    const level = baseLevel({ sinks: [{ pos: [3, 3], rotation: 0 }], target: { type: 'ore', count: 5 } })
    const world = build(level, belts(1, 3, 2))
    seedItems(world, [{ pos: [2, 3], item: 'ore' }])

    step(world) // the sink pulls it into its input buffer
    const before = snapshot(world)
    step(world) // and consumes it

    const transits = deriveTransits(before, snapshot(world))
    expect(transits.some((t) => t.to === null && t.type === 'ore')).toBe(true)
  })

  it('treats the very first snapshot as everything fading in', () => {
    const world = build(baseLevel(), belts(0, 0, 3))
    seedItems(world, [{ pos: [0, 0], item: 'ore' }])
    const transits = deriveTransits(null, snapshot(world))
    expect(transits).toHaveLength(1)
    expect(transits[0].from).toBeNull()
  })
})

describe('a saturated line feeding a sink', () => {
  it('keeps flowing, because the sink frees its buffer every tick', () => {
    // The ordinary steady state: source emitting, every belt cell full, sink
    // eating one per tick. Nothing ahead ever *looks* empty, so this is the
    // case that renders frozen unless consumption counts as freeing a slot.
    const level = baseLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      sinks: [{ pos: [5, 3], rotation: 0 }],
      target: { type: 'circle', count: 99 },
    })
    const world = build(level, belts(1, 3, 4))
    for (let i = 0; i < 12; i += 1) step(world)

    const before = snapshot(world)
    step(world)
    const transits = deriveTransits(before, snapshot(world))

    // The two snapshots are occupancy-identical — every slot filled before is
    // filled after — and yet every item on the line moved.
    expect([...occupancyOf(before).keys()].sort()).toEqual([...occupancyOf(snapshot(world)).keys()].sort())
    expect(transits.filter(moved).length).toBeGreaterThanOrEqual(3)
  })
})

describe('deliveriesBetween', () => {
  const lineToSink = () => {
    const level = baseLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      sinks: [{ pos: [4, 3], rotation: 0 }],
      target: { type: 'circle', count: 99 },
    })
    return build(level, belts(1, 3, 3))
  }

  it('reports nothing before anything has arrived', () => {
    const world = lineToSink()
    const before = snapshot(world)
    step(world)
    expect(deliveriesBetween(before, snapshot(world))).toEqual([])
  })

  it('reports a delivery at the sink that took it', () => {
    const world = lineToSink()
    // §14 case 1: the first item is counted on tick 4, so it sits in the sink
    // buffer at the end of tick 3.
    for (let i = 0; i < 3; i += 1) step(world)

    const before = snapshot(world)
    step(world)
    const landed = deliveriesBetween(before, snapshot(world))

    expect(landed).toHaveLength(1)
    expect(landed[0].type).toBe('circle')
    expect(landed[0].at).toEqual({ x: 4, y: 3 })
  })

  it('agrees with the engine own delivered counter, tick after tick', () => {
    // The counter is the authority on how many landed; the buffers are the
    // only thing that knows where. They must never disagree.
    const world = lineToSink()
    let before = snapshot(world)

    for (let tick = 0; tick < 12; tick += 1) {
      step(world)
      const after = snapshot(world)
      const counted = (after.delivered['circle'] ?? 0) - (before.delivered['circle'] ?? 0)
      expect(deliveriesBetween(before, after)).toHaveLength(counted)
      before = after
    }
  })

  it('still fires while the sink is being refilled every tick', () => {
    // The case the item tween cannot show: buffer emptied and refilled on the
    // same tick, so occupancy never changes and nothing appears to happen.
    const world = lineToSink()
    for (let i = 0; i < 6; i += 1) step(world)

    const before = snapshot(world)
    step(world)
    expect(before.buildings.find((b) => b.type === 'sink')?.inputs['W']).toBe('circle')
    expect(deliveriesBetween(before, snapshot(world))).toHaveLength(1)
  })
})

describe('the tween itself', () => {
  it('starts at the source and lands exactly on the target', () => {
    const a = { x: 10, y: 20 }
    const b = { x: 110, y: 220 }
    expect(lerpPoint(a, b, 0)).toEqual(a)
    expect(lerpPoint(a, b, 1)).toEqual(b)
  })

  it('eases out, so it covers more ground early than late', () => {
    const first = ease(0.25) - ease(0)
    const last = ease(1) - ease(0.75)
    expect(first).toBeGreaterThan(last)
  })

  it('never overshoots, whatever it is handed', () => {
    for (const t of [-5, -0.1, 0, 0.5, 1, 1.4, 99]) {
      expect(ease(t)).toBeGreaterThanOrEqual(0)
      expect(ease(t)).toBeLessThanOrEqual(1)
    }
  })

  it('grows the delivery ring outward and fades it to nothing', () => {
    const start = pulseGeometry(60, 0)
    const end = pulseGeometry(60, 1)
    expect(end.size).toBeGreaterThan(start.size)
    expect(start.opacity).toBeGreaterThan(0)
    expect(end.opacity).toBe(0)
  })
})

describe('jobProgress', () => {
  const machine = (timer: number | null) =>
    ({ job: timer === null ? null : { timer, product: 'disc' } }) as never

  it('is null while idle', () => {
    expect(jobProgress(machine(null), 2)).toBeNull()
  })

  it('fills as the timer counts down', () => {
    expect(jobProgress(machine(2), 2)).toBe(0)
    expect(jobProgress(machine(1), 2)).toBe(0.5)
    expect(jobProgress(machine(0), 2)).toBe(1)
  })

  it('reads full for a finished job still waiting to hand over', () => {
    // §6 phase 5 leaves the timer at 0 while the output buffer is blocked, and
    // a held machine should look done rather than idle.
    expect(jobProgress(machine(0), 2)).toBe(1)
  })
})
