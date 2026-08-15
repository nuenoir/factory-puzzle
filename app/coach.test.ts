/**
 * The coach.
 *
 * These matter more than most tests here, because a wrong hint is worse than
 * silence: it sends a stuck player to the wrong part of the board and teaches
 * them the game is lying. So every case builds a real world through
 * `createWorld` and asks the coach about the snapshot the engine produced,
 * rather than hand-writing a snapshot that agrees with the expectation.
 */

import { describe, expect, it } from 'vitest'
import { createWorld, simulate, snapshot, stateKey, step, type Level, type Placement, type Snapshot } from '@factory/sim'

import { nextHint, type CoachInput } from './coach'
import { statusAfterStep } from './run'

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'coach-test',
    grid: { width: 7, height: 7 },
    sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
    sinks: [{ pos: [6, 3], rotation: 0 }],
    target: { type: 'widget', count: 5 },
    max_ticks: 300,
    available: ['conveyor', 'splitter', 'press', 'assembler'],
    recipes: { press: { circle: 'disc' }, assembler: [{ in: ['disc', 'disc'], out: 'widget' }] },
    par: 21,
    ...overrides,
  }
}

/** Build the board and ask the coach, exactly as the app does. */
function ask(level: Level, placements: Placement[], over: Partial<CoachInput> = {}) {
  const built = createWorld(level, { level_id: level.id, placements })
  const snap: Snapshot | null = built.ok ? snapshot(built.world) : null
  return nextHint({
    level,
    snapshot: snap,
    status: 'idle',
    cost: 0,
    hasErrors: !built.ok,
    ...over,
  })
}

describe('what the coach says first', () => {
  it('opens by naming the goal and the one verb that is not guessable', () => {
    const hint = ask(makeLevel(), [])
    expect(hint?.id).toBe('empty')
    expect(hint?.text).toMatch(/drag/i)
    expect(hint?.text).toContain('5 widget')
    // And points at the source, since that is where the drag starts.
    expect(hint?.at).toEqual([0, 3])
  })

  it('explains what the puzzle is before explaining any wiring', () => {
    // Belts only, no machines: the player has not yet grasped that circle has
    // to become widget. Telling them about ports first would be answering a
    // question they have not asked.
    const hint = ask(makeLevel(), [{ type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' }])
    expect(hint?.text).toContain('widget')
    expect(hint?.text).toMatch(/assembler/i)
  })

  it('does not call a board ready when it cannot make what the sink wants', () => {
    /**
     * The one that caught me. A press wired from the source straight into the
     * sink is complete, connected and running — and delivers `disc` forever to
     * a sink asking for `widget`. Connectivity is not correctness, and
     * "everything is connected" is the worst possible thing to say here.
     */
    const level = makeLevel() // circle -> disc by press; disc+disc -> widget
    const wired: Placement[] = [
      { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
      { type: 'press', pos: [2, 3], rotation: 0 },
      { type: 'conveyor', pos: [3, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [4, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [5, 3], in: 'W', out: 'E' },
    ]
    // It really is connected end to end, and it really does not win.
    expect(simulate(level, { level_id: level.id, placements: wired }).won).toBe(false)

    const hint = ask(level, wired)
    expect(hint?.id).not.toBe('ready')
    expect(hint?.text).toMatch(/nothing on the board makes widget/i)
    expect(hint?.text).toMatch(/assembler/i)
  })

  it('names the machine that is missing rather than the concept', () => {
    const level = makeLevel({ target: { type: 'disc', count: 5 } })
    const hint = ask(level, [{ type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' }])
    expect(hint?.text).toMatch(/you need a press/i)
  })

  it('says nothing at all while the factory is running', () => {
    expect(ask(makeLevel(), [], { status: 'running' })).toBeNull()
  })

  it('defers to the error box when the board will not build', () => {
    // Two buildings on one cell: `createWorld` refuses, and its message is more
    // specific than anything the coach could invent.
    const clash: Placement[] = [
      { type: 'press', pos: [2, 3], rotation: 0 },
      { type: 'press', pos: [2, 3], rotation: 0 },
    ]
    expect(ask(makeLevel(), clash)).toBeNull()
  })
})

describe('the lesson the game hinges on', () => {
  /**
   * §4 connects two buildings only when each faces the other. A belt beside the
   * sink pointing past it looks finished and delivers nothing. This is the hint
   * that exists because that exact mistake made four levels in five unbuildable
   * during development.
   */
  it('spots a belt beside the sink that points past it', () => {
    const level = makeLevel({ target: { type: 'circle', count: 5 }, recipes: {} })
    // A run that stops one short and carries straight on past the sink.
    const belts: Placement[] = [
      { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [2, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [3, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [4, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [5, 3], in: 'W', out: 'NE' }, // past the sink
    ]
    const hint = ask(level, belts)
    expect(hint?.id).toMatch(/^sink-not-facing/)
    expect(hint?.at).toEqual([5, 3])
    expect(hint?.text).toMatch(/not pointing at it/i)
    expect(hint?.text).toMatch(/drag onto the sink/i)
  })

  it('and that board really does fail, so the hint is not crying wolf', () => {
    const level = makeLevel({ target: { type: 'circle', count: 5 }, recipes: {} })
    const belts: Placement[] = [
      { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [2, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [3, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [4, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [5, 3], in: 'W', out: 'NE' },
    ]
    expect(simulate(level, { level_id: level.id, placements: belts }).won).toBe(false)
  })

  it('says something different when there is nothing near the sink at all', () => {
    const level = makeLevel({ target: { type: 'circle', count: 5 }, recipes: {} })
    const hint = ask(level, [{ type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' }])
    expect(hint?.id).toBe('sink-unfed')
    expect(hint?.at).toEqual([6, 3])
  })

  it('stops mentioning the sink once the line genuinely reaches it', () => {
    const level = makeLevel({ target: { type: 'circle', count: 5 }, recipes: {} })
    const belts: Placement[] = [1, 2, 3, 4, 5].map((x) => ({
      type: 'conveyor' as const, pos: [x, 3] as const, in: 'W' as const, out: 'E' as const,
    }))
    const hint = ask(level, belts)
    expect(hint?.id).toBe('ready')
    expect(simulate(level, { level_id: level.id, placements: belts }).won).toBe(true)
  })
})

describe('machines', () => {
  it('points at a machine with an input nothing feeds', () => {
    const level = makeLevel({ target: { type: 'disc', count: 5 } })
    const hint = ask(level, [
      { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
      { type: 'press', pos: [3, 3], rotation: 0 }, // gap at (2,3)
    ])
    expect(hint?.id).toMatch(/^starved-3-3/)
    expect(hint?.text).toMatch(/nothing feeding it/i)
    expect(hint?.at).toEqual([3, 3])
  })

  it('mentions the source when nothing carries from it', () => {
    // A machine placed away from the source, with the source untouched.
    const level = makeLevel({ target: { type: 'disc', count: 5 } })
    const hint = ask(level, [{ type: 'press', pos: [3, 1], rotation: 0 }])
    expect(hint?.id).toMatch(/^source-idle/)
    expect(hint?.at).toEqual([0, 3])
  })
})

describe('after a run', () => {
  const level = makeLevel({ target: { type: 'circle', count: 5 }, recipes: {} })
  const winning: Placement[] = [1, 2, 3, 4, 5].map((x) => ({
    type: 'conveyor' as const, pos: [x, 3] as const, in: 'W' as const, out: 'E' as const,
  }))

  it('reads a win against par rather than just saying well done', () => {
    const result = simulate(level, { level_id: level.id, placements: winning })
    expect(result.won).toBe(true)
    const over = ask(level, winning, { status: 'won', cost: result.cost })
    expect(over?.tone).toBe('win')
    expect(over?.text).toContain(String(result.cost))
  })

  it('celebrates beating par, which is reachable', () => {
    // par is the cheapest the *search* found, never proven optimal.
    const hint = ask(level, winning, { status: 'won', cost: level.par - 2 })
    expect(hint?.id).toBe('won-under')
    expect(hint?.text).toMatch(/2 under par/)
  })

  it('names par exactly when it is matched', () => {
    const hint = ask(level, winning, { status: 'won', cost: level.par })
    expect(hint?.id).toBe('won-par')
  })

  it('tells a timeout that delivered nothing from one that was merely slow', () => {
    expect(ask(level, winning, { status: 'timeout' })?.id).toBe('timeout-none')
  })

  it('explains a jam by pointing at what cannot hand anything on', () => {
    // A belt running into empty space. It has to actually be *run* to jam —
    // asking about a tick-zero board would be asking about a factory in which
    // nothing has happened yet, which is not what a stuck player is looking at.
    const deadEnd: Placement[] = [
      { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
      { type: 'conveyor', pos: [2, 3], in: 'W', out: 'E' },
    ]
    const built = createWorld(level, { level_id: level.id, placements: deadEnd })
    if (!built.ok) throw new Error(built.errors.map((e) => e.message).join('; '))

    let outcome = statusAfterStep({ delivered: 0, target: 5, tickCount: 0, maxTicks: 300, stalled: false })
    for (let i = 0; i < 50 && outcome === 'running'; i += 1) {
      const before = stateKey(built.world)
      step(built.world)
      outcome = statusAfterStep({
        delivered: built.world.delivered.get('circle') ?? 0,
        target: level.target.count,
        tickCount: built.world.tickCount,
        maxTicks: level.max_ticks,
        stalled: stateKey(built.world) === before,
      })
    }
    expect(outcome).toBe('jammed')

    const hint = nextHint({
      level,
      snapshot: snapshot(built.world),
      status: 'jammed',
      cost: 2,
      hasErrors: false,
    })
    expect(hint?.tone).toBe('problem')
    // The belt at the end of the line is the one holding something it cannot
    // pass on, and that is where the player has to look.
    expect(hint?.at).toEqual([2, 3])
    expect(hint?.text).toMatch(/nowhere to hand it|face/i)
  })
})

describe('hint identity', () => {
  it('keeps the same id while the same problem persists', () => {
    const level = makeLevel({ target: { type: 'circle', count: 5 }, recipes: {} })
    const belts: Placement[] = [{ type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' }]
    expect(ask(level, belts)?.id).toBe(ask(level, belts)?.id)
  })

  it('changes id when the problem moves to another cell', () => {
    const level = makeLevel({ target: { type: 'disc', count: 5 } })
    const a = ask(level, [{ type: 'press', pos: [3, 1], rotation: 0 }])
    const b = ask(level, [
      { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
      { type: 'press', pos: [3, 3], rotation: 0 },
    ])
    expect(a?.id).not.toBe(b?.id)
  })
})
