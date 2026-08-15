/**
 * The tutorial script.
 *
 * The important test is the last one: following the steps in order, doing
 * exactly and only what each says, has to end in a working factory. A tutorial
 * that teaches a sequence which does not actually work is worse than none, and
 * it is the sort of thing that stays broken because the author already knows
 * the answer and never re-reads their own instructions.
 */

import { describe, expect, it } from 'vitest'
import {
  createWorld,
  simulate,
  snapshot,
  stateKey,
  step,
  validateLevel,
  type PosTuple,
  type Level,
  type Placement,
  type Snapshot,
} from '@factory/sim'

import { editReducer, type PlaceableType } from './editor'
import { onCell, type Drag } from './gesture'
import { statusAfterStep, type StepOutcome } from './run'
import {
  STORAGE_KEY,
  TUTORIAL_STEPS,
  currentStep,
  markTutorialDone,
  stepNumber,
  tutorialDone,
  type Board,
  type Store,
} from './tutorial'
import tutorialJson from '../levels/tutorial.json'

const level = tutorialJson as unknown as Level

/** The board as the app would have it after these placements. */
function board(placements: Placement[], status: Board['status'] = 'idle'): Board {
  const built = createWorld(level, { level_id: level.id, placements })
  return { snapshot: built.ok ? snapshot(built.world) : null, status }
}

function fakeStore(initial: Record<string, string> = {}): Store & { data: Record<string, string> } {
  const data = { ...initial }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}

const BELT_IN: Placement = { type: 'conveyor', pos: [1, 1], in: 'W', out: 'E' }
const PRESS: Placement = { type: 'press', pos: [2, 1], rotation: 0 }
const BELT_OUT: Placement = { type: 'conveyor', pos: [3, 1], in: 'W', out: 'E' }

describe('the level it teaches on', () => {
  it('is a level the simulator will load', () => {
    // Hand-written, unlike the pool, so nothing else has ever checked it — and
    // a malformed one is a blank board on somebody's first ever go.
    expect(validateLevel(level)).toEqual([])
  })

  it('is small enough to hold in your head', () => {
    expect(level.grid.width * level.grid.height).toBeLessThanOrEqual(15)
    // Two tools, so the palette does not present six choices to someone who has
    // not yet made one.
    expect(level.available).toEqual(['conveyor', 'press'])
  })

  it('is not one of the daily puzzles, so a first go cannot spoil one', async () => {
    const pool = (await import('../levels/daily.json')).default as unknown as Level[]
    expect(pool.some((l) => l.id === level.id)).toBe(false)
  })
})

describe('walking the steps', () => {
  it('opens on the one verb nobody guesses', () => {
    const step = currentStep(board([]))
    expect(step?.id).toBe('lay-a-belt')
    expect(step?.text).toMatch(/drag/i)
    expect(stepNumber(board([]))).toBe(1)
  })

  it('moves on once a belt leaves the source', () => {
    expect(currentStep(board([BELT_IN]))?.id).toBe('place-a-press')
  })

  it('does not accept a belt that is merely near the source', () => {
    // Pointing away: adjacent, and not connected. §4 wants both facings.
    const facingAway: Placement = { type: 'conveyor', pos: [1, 1], in: 'E', out: 'W' }
    expect(currentStep(board([facingAway]))?.id).toBe('lay-a-belt')
  })

  it('still asks for the belt when only a press has been placed', () => {
    // Earliest outstanding step, not furthest reached: with nothing leaving the
    // source, "lay a belt" is still the honest next instruction.
    expect(currentStep(board([PRESS]))?.id).toBe('lay-a-belt')
  })

  it('asks for the press to be fed when the belt misses it', () => {
    // A belt that leaves the source correctly and then turns away from the
    // press. Steps one and two are done; the press is still starving.
    const misrouted: Placement = { type: 'conveyor', pos: [1, 1], in: 'W', out: 'SE' }
    expect(currentStep(board([misrouted, PRESS]))?.id).toBe('feed-the-press')
  })

  it('teaches the facing rule at the point it bites', () => {
    const step = currentStep(board([BELT_IN, PRESS]))
    expect(step?.id).toBe('reach-the-sink')
    expect(step?.text).toMatch(/each faces the other/i)
    expect(step?.text).toMatch(/drag onto the sink/i)
  })

  it('is not fooled by a belt beside the sink pointing past it', () => {
    // The mistake the whole game hinges on: adjacent, complete-looking, dead.
    const past: Placement = { type: 'conveyor', pos: [3, 1], in: 'W', out: 'NE' }
    expect(currentStep(board([BELT_IN, PRESS, past]))?.id).toBe('reach-the-sink')
    expect(simulate(level, { level_id: level.id, placements: [BELT_IN, PRESS, past] }).won).toBe(false)
  })

  it('asks for Run once the line is complete', () => {
    expect(currentStep(board([BELT_IN, PRESS, BELT_OUT]))?.id).toBe('run-it')
  })

  it('ends only on a win, not merely on a full board', () => {
    const complete = [BELT_IN, PRESS, BELT_OUT]
    expect(currentStep(board(complete, 'idle'))?.id).toBe('run-it')
    expect(currentStep(board(complete, 'won'))).toBeNull()
    expect(stepNumber(board(complete, 'won'))).toBe(TUTORIAL_STEPS.length)
  })

  it('lets someone who ignores it entirely skip straight to the end', () => {
    // Steps report the earliest outstanding one rather than counting ticks, so
    // solving it outright satisfies all of them at once.
    expect(currentStep(board([BELT_IN, PRESS, BELT_OUT], 'won'))).toBeNull()
  })

  it('says nothing confident when the board will not build', () => {
    const clash: Placement[] = [PRESS, { type: 'press', pos: [2, 1], rotation: 0 }]
    const b = board(clash)
    expect(b.snapshot).toBeNull()
    expect(currentStep(b)?.id).toBe('lay-a-belt')
  })
})

/**
 * Following the script with a finger, not with the answer.
 *
 * The test below this one walks `Placement` objects, which is solver output —
 * it silently assumes the right tool was in hand for each one. The palette is
 * ordinary state that nothing resets between steps, so that assumption was
 * false: only step 2 ever named a tool, and a player who did what it said was
 * still holding PRESS three steps later. Dragging to the sink then laid a
 * press, `reach-the-sink` was satisfied anyway (a press at r0 outputs E, the
 * sink accepts from W), and the banner said "That is a factory" over a board
 * that delivered nothing in 300 ticks.
 *
 * So these replay through the real `onCell` and `editReducer`, carrying a tool
 * the way App.tsx does. CLAUDE.md charters this file to check the script
 * "doing exactly and only what each step says" — that has to include which
 * button the step tells you to press.
 */
describe('following the script with the palette in hand', () => {
  const fixtures = new Set([...level.sources, ...level.sinks].map((f) => `${f.pos[0]},${f.pos[1]}`))
  const isFixture = (p: PosTuple) => fixtures.has(`${p[0]},${p[1]}`)

  /** One gesture, exactly as the board delivers it. */
  function swipe(
    placements: readonly Placement[],
    tool: PlaceableType | 'delete',
    cells: readonly PosTuple[],
  ): Placement[] {
    let state = [...placements]
    let drag: Drag | null = null
    cells.forEach((pos, i) => {
      const out = onCell(i === 0 ? 'down' : 'move', pos, { tool, rotation: 0, placements: state, drag, isFixture })
      drag = out.drag
      for (const a of out.actions) state = editReducer(state, a)
    })
    const up = onCell('up', cells[cells.length - 1], {
      tool, rotation: 0, placements: state, drag, isFixture,
    })
    for (const a of up.actions) state = editReducer(state, a)
    return state
  }

  it('names its tool in the text of every step that places something', () => {
    // The prose and the `tool` field have to agree, because the prose is the
    // only thing the player ever sees.
    for (const step of TUTORIAL_STEPS) {
      if (step.tool === undefined) continue
      const named = step.tool === 'conveyor' ? 'BELT' : step.tool.toUpperCase()
      expect(step.text, `${step.id} never says which tool to pick`).toContain(named)
    }
  })

  it('wins when each step is done with the tool that step names', () => {
    const gestures: Record<string, readonly PosTuple[]> = {
      'lay-a-belt': [[0, 1], [1, 1]],
      'place-a-press': [[2, 1]],
      'feed-the-press': [[1, 1], [2, 1]],
      'reach-the-sink': [[2, 1], [3, 1], [4, 1]],
    }

    let placed: Placement[] = []
    const visited: string[] = []
    for (let guard = 0; guard < TUTORIAL_STEPS.length; guard += 1) {
      const step = currentStep(board(placed))
      if (step === null || step.id === 'run-it') break
      visited.push(step.id)
      expect(step.tool, `${step.id} has no tool to pick up`).toBeDefined()
      placed = swipe(placed, step.tool!, gestures[step.id])
    }

    expect(visited).toEqual(['lay-a-belt', 'place-a-press', 'reach-the-sink'])
    expect(currentStep(board(placed))?.id).toBe('run-it')

    const result = simulate(level, { level_id: level.id, placements: placed })
    expect(result.won).toBe(true)
    expect(result.cost).toBe(level.par)
  })

  it('does not call a board of presses a factory', () => {
    // The exact failure the tool naming exists to prevent: step 2's PRESS still
    // in hand when step 4 asks for a belt. Kept as a test so that if the script
    // ever stops naming its tools, this is what it will cost.
    let p = swipe([], 'conveyor', [[0, 1], [1, 1]])
    p = swipe(p, 'press', [[2, 1]])
    const withPress = swipe(p, 'press', [[3, 1], [4, 1]])

    expect(withPress.filter((x) => x.type === 'press')).toHaveLength(2)
    expect(currentStep(board(withPress))?.id).toBe('run-it') // it *looks* finished
    expect(simulate(level, { level_id: level.id, placements: withPress }).won).toBe(false)

    // And with the belt the step now names, the same gesture wins at par.
    const withBelt = swipe(p, 'conveyor', [[3, 1], [4, 1]])
    const run = simulate(level, { level_id: level.id, placements: withBelt })
    expect(run.won).toBe(true)
    expect(run.cost).toBe(level.par)
  })

  it('leaves a way out of a cell the player has filled by mistake', () => {
    // Laying anything on (1,1) blocks step 1 permanently: it is the only cell
    // the source's single E output can reach, and a belt route may not begin by
    // moving onto a building. ERASE is the only escape, so step 1 has to say so.
    let p = swipe([], 'press', [[1, 1]])
    const stuck = swipe(p, 'conveyor', [[0, 1], [1, 1]])
    expect(stuck).toEqual(p) // step 1's own instruction does nothing
    expect(currentStep(board(stuck))?.id).toBe('lay-a-belt')
    expect(TUTORIAL_STEPS[0].text).toMatch(/erase/i)

    p = swipe(stuck, 'delete', [[1, 1]])
    const freed = swipe(p, 'conveyor', [[0, 1], [1, 1]])
    expect(currentStep(board(freed))?.id).toBe('place-a-press')
  })
})

describe('the script actually works', () => {
  it('reaches a real win by following the steps in order', () => {
    /**
     * Do only what each step asks, in the order it asks, and check the factory
     * the instructions describe genuinely runs — rather than trusting that the
     * author, who already knows the answer, wrote instructions that lead to it.
     */
    const placed: Placement[] = []
    const additions: Placement[] = [BELT_IN, PRESS, BELT_OUT]
    const visited: string[] = []

    for (const addition of additions) {
      const step = currentStep(board(placed))
      expect(step, 'ran out of steps before the factory was built').not.toBeNull()
      visited.push(step!.id)
      placed.push(addition)
    }

    // Every instruction before "Run" has been followed exactly once.
    expect(visited).toEqual(['lay-a-belt', 'place-a-press', 'reach-the-sink'])
    expect(currentStep(board(placed))?.id).toBe('run-it')

    const result = simulate(level, { level_id: level.id, placements: placed })
    expect(result.won).toBe(true)
    expect(result.cost).toBe(level.par)
  })

  it('wins through the stepping API the board actually uses', () => {
    const built = createWorld(level, { level_id: level.id, placements: [BELT_IN, PRESS, BELT_OUT] })
    if (!built.ok) throw new Error(built.errors.map((e) => e.message).join('; '))

    let outcome: StepOutcome = 'running'
    for (let i = 0; i < 60 && outcome === 'running'; i += 1) {
      const before = stateKey(built.world)
      step(built.world)
      outcome = statusAfterStep({
        delivered: built.world.delivered.get(level.target.type) ?? 0,
        target: level.target.count,
        tickCount: built.world.tickCount,
        maxTicks: level.max_ticks,
        stalled: stateKey(built.world) === before,
      })
    }
    expect(outcome).toBe('won')
    expect(currentStep({ snapshot: snapshot(built.world) as Snapshot, status: outcome })).toBeNull()
  })
})

describe('remembering it was done', () => {
  it('starts undone and stays done once marked', () => {
    const store = fakeStore()
    expect(tutorialDone(store)).toBe(false)
    expect(markTutorialDone(store)).toBe(true)
    expect(tutorialDone(store)).toBe(true)
    expect(Object.keys(store.data)).toEqual([STORAGE_KEY])
  })

  it('treats unreadable storage as not yet done', () => {
    // Showing it twice is a small annoyance; hiding it from someone who has
    // never played is the entire problem it exists to solve.
    const hostile: Store = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('quota') },
    }
    expect(tutorialDone(hostile)).toBe(false)
    expect(tutorialDone(null)).toBe(false)
    expect(markTutorialDone(hostile)).toBe(false)
  })

  it('ignores a value that is not the one we wrote', () => {
    expect(tutorialDone(fakeStore({ [STORAGE_KEY]: 'yes' }))).toBe(false)
  })
})
