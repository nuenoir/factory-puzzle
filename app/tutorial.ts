/**
 * The first two minutes.
 *
 * Three things about this game cannot be guessed from looking at it: belts are
 * drawn by dragging rather than tapping, the sink usually wants something the
 * source does not make, and — the one that ends sessions — §4 joins two
 * buildings only when *each* faces the other, so a belt beside the sink
 * pointing past it runs happily and delivers nothing.
 *
 * So the tutorial is a real level with a script over it, not a slideshow. Each
 * step is a sentence and a question about the board; the current step is the
 * first one whose question is still "no". Nothing is forced and nothing is
 * modal: a player who ignores the text and solves it outright walks through
 * every step at once, which is the correct outcome rather than a bug.
 *
 * It runs on its own small board so a first attempt cannot spoil today's
 * puzzle, and it teaches on a level where the answer is short enough to hold
 * in your head.
 */

import { neighbourOf, opposite, type BuildingSnapshot, type Snapshot } from '@factory/sim'

import type { StepOutcome } from './run'

export const STORAGE_KEY = 'factory-puzzle:tutorial:v1'

export interface TutorialStep {
  readonly id: string
  /** What to do, in one sentence, addressed to the player. */
  readonly text: string
  /** True once the board shows this has been done. */
  readonly done: (board: Board) => boolean
}

/** Everything a step is allowed to look at. */
export interface Board {
  readonly snapshot: Snapshot | null
  readonly status: 'idle' | StepOutcome
}

const at = (snapshot: Snapshot, x: number, y: number) =>
  snapshot.buildings.find((b) => b.x === x && b.y === y)

/** §4 again, from the engine's own resolved ports. */
function connects(from: BuildingSnapshot, to: BuildingSnapshot): boolean {
  for (const d of from.outPorts) {
    const n = neighbourOf(from.x, from.y, d)
    if (n.x === to.x && n.y === to.y) return to.inPorts.includes(opposite(d))
  }
  return false
}

const sourceOf = (s: Snapshot) => s.buildings.find((b) => b.type === 'source')
const sinkOf = (s: Snapshot) => s.buildings.find((b) => b.type === 'sink')

/**
 * The script for `levels/tutorial.json`: source at (0,1), sink at (4,1), and a
 * press turning ore into plate somewhere between them.
 *
 * Deliberately four steps rather than one per mechanic. Laying the first belt
 * and finishing the line into the sink are the same verb, but they are
 * different lessons — the second is the only place the facing rule can be
 * taught at the moment it bites.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'lay-a-belt',
    text: 'Belts are drawn, not tapped. Press on the source and drag to the right to lay one.',
    done: ({ snapshot }) => {
      if (snapshot === null) return false
      const source = sourceOf(snapshot)
      if (source === undefined) return false
      return snapshot.buildings.some((b) => b.type === 'conveyor' && connects(source, b))
    },
  },
  {
    id: 'place-a-press',
    text: 'The sink wants plate, and the source only makes ore. Choose PRESS and tap the cell after your belt — a press turns ore into plate.',
    done: ({ snapshot }) => snapshot !== null && snapshot.buildings.some((b) => b.type === 'press'),
  },
  {
    id: 'feed-the-press',
    text: 'The press needs the ore. Make sure your belt runs into it — drag onto the press itself and the belt turns to face it.',
    done: ({ snapshot }) => {
      if (snapshot === null) return false
      const press = snapshot.buildings.find((b) => b.type === 'press')
      if (press === undefined) return false
      return snapshot.buildings.some((b) => b !== press && connects(b, press))
    },
  },
  {
    id: 'reach-the-sink',
    text: 'Now run a belt from the press into the sink. Two buildings only connect when each faces the other, so drag onto the sink itself.',
    done: ({ snapshot }) => {
      if (snapshot === null) return false
      const sink = sinkOf(snapshot)
      if (sink === undefined) return false
      return snapshot.buildings.some((b) => connects(b, sink))
    },
  },
  {
    id: 'run-it',
    text: 'That is a factory. Press Run and watch the ore come through.',
    done: ({ status }) => status === 'won',
  },
]

/**
 * The step the player is on: the first one not yet done.
 *
 * Steps are not required to complete in order — someone who places the press
 * before laying any belt has genuinely done step two — so this reports the
 * earliest outstanding one rather than counting how many have been ticked.
 * Returns null when every step is done, which is what ends the tutorial.
 */
export function currentStep(board: Board, steps: readonly TutorialStep[] = TUTORIAL_STEPS): TutorialStep | null {
  return steps.find((step) => !step.done(board)) ?? null
}

/** How far along, for a "2 of 5" readout. 1-based; equals length when finished. */
export function stepNumber(board: Board, steps: readonly TutorialStep[] = TUTORIAL_STEPS): number {
  const step = currentStep(board, steps)
  return step === null ? steps.length : steps.indexOf(step) + 1
}

/* ---- has it been done before? ------------------------------------------ */

/** The slice of `localStorage` this needs, so tests can hand over a fake. */
export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Whether to open on the tutorial. Anything unreadable counts as "not yet",
 * because showing the tutorial twice is a small annoyance and hiding it from
 * someone who has never played is the whole problem it exists to solve.
 */
export function tutorialDone(store: Store | null = defaultStore()): boolean {
  if (store === null) return false
  try {
    return store.getItem(STORAGE_KEY) === 'done'
  } catch {
    return false
  }
}

export function markTutorialDone(store: Store | null = defaultStore()): boolean {
  if (store === null) return false
  try {
    store.setItem(STORAGE_KEY, 'done')
    return true
  } catch {
    return false
  }
}

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
