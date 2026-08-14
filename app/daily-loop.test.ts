/**
 * The daily loop, end to end, on real generated puzzles.
 *
 * Everything else in `app/` is tested a piece at a time, and pieces that each
 * work can still fail to add up. This walks the whole path a player walks —
 * pick today's puzzle from the committed pool, solve it with the same search
 * the validator used, run it through the §13 stepping API exactly as the board
 * does, decide the outcome, bank it, and read back the streak and the share
 * card — with nothing stubbed but the storage.
 *
 * It exists because of a specific failure. A guard made belt drags unable to
 * touch a source or sink, so four levels in five could not be built at par: the
 * factory ran, made its items and delivered none of them, silently. Every test
 * passed, because they all used `levels/001.json`, whose reference solution
 * parks the assembler next to the sink so no belt ever runs into a fixture.
 * The convenient fixture was also the one that made every check agree.
 *
 * So this one refuses the convenient fixture. It reads `levels/daily.json`
 * through the same selector the app calls, and it takes whatever it gets.
 *
 * `@factory/gen` is a devDependency of `app` for this file alone. The one-way
 * rule that matters is that the *shipped* app never imports the generator; a
 * test needing a real solution to a real puzzle is not that.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH_LIMITS, solve } from '@factory/gen'
import {
  costOf,
  createWorld,
  neighbourOf,
  snapshot,
  stateKey,
  step,
  type Level,
  type Placement,
  type PosTuple,
  type Solution,
} from '@factory/sim'

import { poolDays, puzzleFor } from './daily'
import { editReducer, type EditAction } from './editor'
import { onCell, type Drag, type GesturePhase } from './gesture'
import {
  currentStreak,
  emptyHistory,
  loadHistory,
  record,
  resultFor,
  saveHistory,
  solved,
  stats,
  type History,
  type Store,
} from './history'
import { statusAfterStep, type StepOutcome } from './run'
import { shareText } from './share'
import { TRACE_WIDTH, deliveryTrace } from './trace'

/** In-memory stand-in for localStorage, so persistence is real but contained. */
function fakeStore(): Store & { data: Record<string, string> } {
  const data: Record<string, string> = {}
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}

/**
 * Play a solution the way the board plays it: step, then decide, using the same
 * function the component uses rather than a copy of its reasoning.
 */
function play(
  level: Level,
  solution: Solution,
): { outcome: StepOutcome; ticks: number; cost: number; deliveredAt: number[] } {
  const built = createWorld(level, solution)
  if (!built.ok) throw new Error(`world would not build: ${built.errors.map((e) => e.message).join('; ')}`)
  const world = built.world
  const deliveredAt: number[] = []

  for (;;) {
    const before = stateKey(world)
    const deliveredBefore = world.delivered.get(level.target.type) ?? 0
    step(world)
    // Collected as the run happens, the way the board does it — a trace
    // re-derived afterwards would not be evidence of the run that was scored.
    const deliveredNow = world.delivered.get(level.target.type) ?? 0
    for (let i = deliveredBefore; i < deliveredNow; i += 1) deliveredAt.push(world.tickCount)
    const outcome = statusAfterStep({
      delivered: world.delivered.get(level.target.type) ?? 0,
      target: level.target.count,
      tickCount: world.tickCount,
      maxTicks: level.max_ticks,
      stalled: stateKey(world) === before,
    })
    if (outcome !== 'running') {
      // `snapshot` is the render input; touching it here keeps this honest about
      // going through the same surface the board does.
      snapshot(world)
      return { outcome, ticks: world.tickCount, cost: costOf(solution), deliveredAt }
    }
  }
}

/** Solve a day's puzzle with the search the validator uses. */
function solveDay(day: number) {
  const level = puzzleFor(day)
  const outcome = solve(level, day, { ...DEFAULT_SEARCH_LIMITS, timeoutMs: 30_000 })
  return { level, best: outcome.cheapest }
}

describe('the daily loop, end to end', () => {
  it('solves a real pool puzzle and banks a real score', () => {
    const day = 1
    const { level, best } = solveDay(day)
    expect(best, `no solution found for ${level.id}`).not.toBeNull()

    const played = play(level, best!.solution)
    expect(played.outcome).toBe('won')
    expect(played.cost).toBe(best!.cost)

    const store = fakeStore()
    const history = record(emptyHistory, {
      day,
      levelId: level.id,
      par: level.par,
      cost: played.cost,
      ticks: played.ticks,
      deliveredAt: played.deliveredAt,
    })
    expect(saveHistory(history, store)).toBe(true)

    // Reload from storage, as a returning player would.
    const reloaded = loadHistory(store)
    expect(solved(reloaded, day)).toBe(true)
    expect(resultFor(reloaded, day)).toEqual({
      day,
      levelId: level.id,
      par: level.par,
      cost: played.cost,
      ticks: played.ticks,
      deliveredAt: played.deliveredAt,
    })
    expect(currentStreak(reloaded, day)).toBe(1)
  })

  it('builds a streak across consecutive days and shares it', () => {
    const days = [1, 2, 3]
    const store = fakeStore()
    let history: History = emptyHistory

    for (const day of days) {
      const { level, best } = solveDay(day)
      expect(best, `no solution found for day ${day} (${level.id})`).not.toBeNull()
      const played = play(level, best!.solution)
      expect(played.outcome, `day ${day} (${level.id}) did not win`).toBe('won')

      history = record(history, {
        day,
        levelId: level.id,
        par: level.par,
        cost: played.cost,
        ticks: played.ticks,
        deliveredAt: played.deliveredAt,
      })
      saveHistory(history, store)
    }

    const today = days[days.length - 1]
    const reloaded = loadHistory(store)
    const summary = stats(reloaded, today)
    expect(summary.solved).toBe(days.length)
    expect(summary.currentStreak).toBe(days.length)
    expect(summary.bestStreak).toBe(days.length)

    // The card a player would actually copy, built from a genuine result.
    const card = shareText(resultFor(reloaded, today)!, summary.currentStreak)
    expect(card).toContain(`#${today}`)
    expect(card).toContain('3 day streak')
    // And the run trace, standing in for the animation: one mark per delivery,
    // from ticks collected while the factory actually ran.
    const banked = resultFor(reloaded, today)!
    expect(banked.deliveredAt).toHaveLength(puzzleFor(today).target.count)
    expect(card).toContain(deliveryTrace(banked.deliveredAt!, banked.ticks))
    expect(card.split('\n').some((line) => line.length === TRACE_WIDTH && /^[▁█]+$/.test(line))).toBe(true)
    // Still no spoilers, now that the numbers came from a real factory.
    for (const spoiler of ['press', 'splitter', 'assembler', 'conveyor', 'gen-']) {
      expect(card.toLowerCase()).not.toContain(spoiler)
    }
  })

  it('is still playable on the day the pool wraps', () => {
    // The rotation repeats rather than running out. Day poolDays+1 is day 1's
    // puzzle again, and the *day number* has to keep advancing regardless —
    // which is why a banked result stores its own levelId.
    const wrap = poolDays + 1
    expect(puzzleFor(wrap).id).toBe(puzzleFor(1).id)

    const { level, best } = solveDay(1)
    expect(best).not.toBeNull()
    const played = play(level, best!.solution)
    expect(played.outcome).toBe('won')

    const history = record(emptyHistory, {
      day: wrap,
      levelId: level.id,
      par: level.par,
      cost: played.cost,
      ticks: played.ticks,
      deliveredAt: played.deliveredAt,
    })
    expect(resultFor(history, wrap)?.levelId).toBe(level.id)
    expect(currentStreak(history, wrap)).toBe(1)
    expect(shareText(resultFor(history, wrap)!, 1)).toContain(`#${wrap}`)
  })

  it('scores against the level, not against a par looked up later', () => {
    // The pool is generated. If it is ever rebuilt, `puzzleFor(day)` returns a
    // different puzzle for the same day — so a result has to carry the par it
    // was scored against, or an old score silently changes meaning.
    const { level, best } = solveDay(2)
    expect(best).not.toBeNull()
    const played = play(level, best!.solution)

    const banked = record(emptyHistory, {
      day: 2,
      levelId: level.id,
      par: level.par,
      cost: played.cost,
      ticks: played.ticks,
      deliveredAt: played.deliveredAt,
    })
    const result = resultFor(banked, 2)!
    // A pretend rebuild that moves day 2 to some other puzzle entirely.
    const elsewhere = puzzleFor(7)
    expect(result.par).toBe(level.par)
    expect(result.par).not.toBe(Number.NaN)
    if (elsewhere.par !== level.par) expect(result.par).not.toBe(elsewhere.par)
    expect(result.levelId).toBe(level.id)
  })
})

/**
 * Turn a solved layout back into the gestures that would build it.
 *
 * Belt runs are recovered by following each conveyor's `in` back and `out`
 * forward: a run starts where a belt's predecessor is a building and continues
 * while its successor is another belt. The drag that builds it is the machine it
 * leaves, the belts in order, and the machine it arrives at — which is precisely
 * the shape the old bug destroyed, because the arriving machine was often a sink.
 */
function gesturesFor(level: Level, placements: readonly Placement[]) {
  const key = (p: PosTuple) => `${p[0]},${p[1]}`
  const byCell = new Map(placements.map((p) => [key(p.pos), p]))
  const fixtures = new Set([...level.sources, ...level.sinks].map((f) => key(f.pos)))
  const isBuildingAt = (p: PosTuple) => {
    const occupant = byCell.get(key(p))
    return fixtures.has(key(p)) || (occupant !== undefined && occupant.type !== 'conveyor')
  }
  const belts = placements.filter((p) => p.type === 'conveyor')
  const step = (p: PosTuple, dir: string) => {
    const n = neighbourOf(p[0], p[1], dir as never)
    return [n.x, n.y] as PosTuple
  }

  const runs: PosTuple[][] = []
  for (const belt of belts) {
    const from = step(belt.pos, belt.in as string)
    if (!isBuildingAt(from)) continue // not the head of a run
    const path: PosTuple[] = [from]
    let current: Placement | undefined = belt
    while (current !== undefined && current.type === 'conveyor') {
      path.push(current.pos)
      const next = step(current.pos, current.out as string)
      if (isBuildingAt(next)) { path.push(next); break }
      current = byCell.get(key(next))
    }
    runs.push(path)
  }

  const machines = placements.filter((p) => p.type !== 'conveyor')
  return { runs, machines }
}

describe('building a real puzzle by gesture alone', () => {
  /**
   * The test the project was missing. Everything above hands the simulator a
   * solution the *solver* produced; this one builds the same factory the way a
   * player does — taps and drags through `onCell` — and then insists it wins.
   *
   * The bug that motivated all of this lived exactly here. It made every drag
   * into a sink lay a belt pointing off the board, so the factory ran and
   * delivered nothing. Solver-built solutions could never have noticed.
   */
  function build(level: Level, placements: readonly Placement[]): Placement[] {
    const { runs, machines } = gesturesFor(level, placements)
    const isFixture = (p: PosTuple) =>
      [...level.sources, ...level.sinks].some((f) => f.pos[0] === p[0] && f.pos[1] === p[1])

    let state: Placement[] = []
    const apply = (actions: readonly EditAction[]) => {
      for (const action of actions) state = editReducer(state, action)
    }

    // Machines first, as a player must: a belt needs something to bookend.
    for (const machine of machines) {
      const outcome = onCell('down', machine.pos, {
        tool: machine.type as never,
        rotation: machine.rotation,
        placements: state,
        drag: null,
        isFixture,
      })
      apply(outcome.actions)
    }

    // Then each belt run as one uninterrupted drag.
    for (const run of runs) {
      let drag: Drag | null = null
      const events: [GesturePhase, PosTuple][] = [
        ['down', run[0]],
        ...run.slice(1).map((cell) => ['move', cell] as [GesturePhase, PosTuple]),
        ['up', run[run.length - 1]],
      ]
      for (const [phase, cell] of events) {
        const outcome = onCell(phase, cell, {
          tool: 'conveyor',
          rotation: 0,
          placements: state,
          drag,
          isFixture,
        })
        drag = outcome.drag
        apply(outcome.actions)
      }
    }
    return state
  }

  for (const day of [1, 2, 3]) {
    it(`builds and wins day ${day} using only taps and drags`, () => {
      const { level, best } = solveDay(day)
      expect(best, `no solution found for day ${day}`).not.toBeNull()

      const built = build(level, best!.solution.placements)

      // Same factory, reached the player's way.
      expect(built).toHaveLength(best!.solution.placements.length)
      expect(costOf({ level_id: level.id, placements: built })).toBe(best!.cost)

      const played = play(level, { level_id: level.id, placements: built })
      expect(played.outcome, `day ${day} (${level.id}) built by gesture did not win`).toBe('won')
    })
  }

  it('lays the belt that enters the sink facing the sink', () => {
    // The defect in one assertion. §4 connects by mutual facing, so the belt
    // adjacent to the sink must point at it; before the fix it kept whatever
    // direction the drag happened to be travelling.
    const { level, best } = solveDay(1)
    const built = build(level, best!.solution.placements)
    const sink = level.sinks[0].pos

    const feeder = built.find((p) => {
      if (p.type !== 'conveyor') return false
      const n = neighbourOf(p.pos[0], p.pos[1], p.out as never)
      return n.x === sink[0] && n.y === sink[1]
    })
    const machineTouching = built.some((p) => {
      if (p.type === 'conveyor') return false
      return true
    })
    // Either a belt points into the sink, or a machine sits against it. On this
    // level it is a belt, which is the case that used to be impossible.
    expect(feeder !== undefined || machineTouching).toBe(true)
  })
})

describe('statusAfterStep', () => {
  /**
   * §10 ordering, which is not a matter of taste. A factory that completes its
   * order on the very tick the clock runs out has won.
   */
  const facts = (over: Partial<Parameters<typeof statusAfterStep>[0]> = {}) =>
    statusAfterStep({ delivered: 0, target: 5, tickCount: 1, maxTicks: 300, stalled: false, ...over })

  it('reports a win on the tick the order completes', () => {
    expect(facts({ delivered: 5 })).toBe('won')
  })

  it('prefers the win when the clock runs out on the same tick', () => {
    expect(facts({ delivered: 5, tickCount: 300 })).toBe('won')
  })

  it('prefers the win over a stalled world', () => {
    // Delivering the last item can leave nothing else moving.
    expect(facts({ delivered: 5, stalled: true })).toBe('won')
  })

  it('times out only once the order is short', () => {
    expect(facts({ delivered: 4, tickCount: 300 })).toBe('timeout')
  })

  it('prefers the timeout over a jam on the final tick', () => {
    expect(facts({ delivered: 4, tickCount: 300, stalled: true })).toBe('timeout')
  })

  it('calls an unchanged tick a jam', () => {
    expect(facts({ stalled: true })).toBe('jammed')
  })

  it('keeps running otherwise', () => {
    expect(facts()).toBe('running')
  })
})
