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
  type Level,
  type Placement,
  type Snapshot,
} from '@factory/sim'

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

describe('the script actually works', () => {
  it('reaches a real win by following the steps in order', () => {
    /**
     * The test this file exists for. Do only what each step asks, in the order
     * it asks, and check the factory the instructions describe genuinely runs —
     * rather than trusting that the author, who already knows the answer, wrote
     * instructions that lead to it.
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
