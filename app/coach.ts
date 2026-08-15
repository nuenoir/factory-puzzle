/**
 * Why the factory isn't working, in one sentence.
 *
 * The game has one rule that is invisible and fatal: §4 connects two buildings
 * only when *each* faces the other. A belt beside the sink that points past it
 * looks finished, runs, produces items and delivers none of them. That exact
 * mistake made four levels in five unbuildable during development, and it took
 * a debugger to find — a player has no chance, and no reason to stay.
 *
 * So this reads the board and answers the only question a stuck player has.
 * One hint at a time, the most actionable: a list of six problems is not help,
 * it is a wall.
 *
 * Everything here is derived from the snapshot the simulator already produces,
 * including each building's resolved `inPorts` and `outPorts`. Nothing
 * re-implements the connection rule from the level data, because a coach that
 * disagreed with the engine would be worse than no coach.
 */

import {
  neighbourOf,
  opposite,
  type BuildingSnapshot,
  type ItemType,
  type Level,
  type PosTuple,
  type Snapshot,
} from '@factory/sim'

import type { StepOutcome } from './run'

export type HintTone = 'guide' | 'problem' | 'win'

export interface Hint {
  /** Stable across re-renders, so the UI can avoid re-animating the same hint. */
  readonly id: string
  readonly text: string
  readonly tone: HintTone
  /** A cell worth looking at. The board rings it. */
  readonly at?: PosTuple
}

export interface CoachInput {
  readonly level: Level
  /** Null when the board will not build; the error list speaks for itself then. */
  readonly snapshot: Snapshot | null
  readonly status: 'idle' | StepOutcome
  readonly cost: number
  readonly hasErrors: boolean
}

const isFixture = (b: BuildingSnapshot) => b.type === 'source' || b.type === 'sink'
const posOf = (b: BuildingSnapshot): PosTuple => [b.x, b.y]

/**
 * §4, using the ports the engine resolved rather than ones worked out again
 * here: `from` has an output facing `to`, and `to` an input facing back.
 */
function connects(from: BuildingSnapshot, to: BuildingSnapshot): boolean {
  for (const d of from.outPorts) {
    const n = neighbourOf(from.x, from.y, d)
    if (n.x === to.x && n.y === to.y) return to.inPorts.includes(opposite(d))
  }
  return false
}

/** Anything adjacent, by cell rather than by port — used to tell "nothing is
 *  there" apart from "something is there and pointing the wrong way". */
function touching(snapshot: Snapshot, b: BuildingSnapshot): BuildingSnapshot[] {
  const neighbours: BuildingSnapshot[] = []
  for (const other of snapshot.buildings) {
    if (other === b) continue
    const adjacent = (['E', 'SE', 'SW', 'W', 'NW', 'NE'] as const).some((d) => {
      const n = neighbourOf(b.x, b.y, d)
      return n.x === other.x && n.y === other.y
    })
    if (adjacent) neighbours.push(other)
  }
  return neighbours
}

const feeds = (snapshot: Snapshot, target: BuildingSnapshot) =>
  snapshot.buildings.filter((b) => connects(b, target))

const drains = (snapshot: Snapshot, source: BuildingSnapshot) =>
  snapshot.buildings.filter((b) => connects(source, b))

/** A friendly name. Players see "press", not "press at 3,2". */
function name(b: BuildingSnapshot): string {
  switch (b.type) {
    case 'source': return 'the source'
    case 'sink': return 'the sink'
    case 'conveyor': return 'that belt'
    default: return `the ${b.type}`
  }
}

/** Names read naturally mid-sentence and look broken at the start of one. */
const opening = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** How the level says the target gets made, phrased for someone who is stuck. */
function recipeAdvice(level: Level): string | null {
  const target = level.target.type
  const press = Object.entries(level.recipes.press ?? {}).find(([, out]) => out === target)
  if (press) return `A press turns ${press[0]} into ${target}.`
  const assembled = (level.recipes.assembler ?? []).find((r) => r.out === target)
  if (assembled) {
    const [a, b] = assembled.in
    return a === b
      ? `An assembler combines two ${a} into ${target} — which means splitting one line in two.`
      : `An assembler combines ${a} and ${b} into ${target}.`
  }
  return null
}

/**
 * Every item type the board *as built* can currently make.
 *
 * A closure over the recipe tables, gated on the machines actually placed
 * rather than the ones the level offers. Connectivity is not correctness: a
 * press wired neatly from the source to the sink is a complete, running,
 * beautifully connected factory that delivers the wrong item forever, and
 * "everything is connected" is a terrible thing to tell someone in that
 * position.
 *
 * This is a different question from the validator's stage A — that one asks
 * what the *level* permits, this asks what the player has built — so it is not
 * a duplicate of it, and `app` may not import the generator at runtime anyway.
 */
function makeableNow(level: Level, built: readonly BuildingSnapshot[]): Set<ItemType> {
  const placed = (type: string) => built.some((b) => b.type === type)
  const press = placed('press') ? level.recipes.press ?? {} : {}
  const assemblers = placed('assembler') ? level.recipes.assembler ?? [] : []

  const reachable = new Set<ItemType>(level.sources.map((s) => s.emits))
  for (let grew = true; grew; ) {
    grew = false
    for (const type of [...reachable]) {
      const out = press[type]
      if (out !== undefined && !reachable.has(out)) { reachable.add(out); grew = true }
    }
    for (const recipe of assemblers) {
      const [a, b] = recipe.in
      if (reachable.has(a) && reachable.has(b) && !reachable.has(recipe.out)) {
        reachable.add(recipe.out)
        grew = true
      }
    }
  }
  return reachable
}

/** The machine the target needs and the board has not got. */
function missingMachine(level: Level, built: readonly BuildingSnapshot[]): string | null {
  const target = level.target.type
  const byPress = Object.entries(level.recipes.press ?? {}).some(([, out]) => out === target)
  const byAssembler = (level.recipes.assembler ?? []).some((r) => r.out === target)
  if (byAssembler && !built.some((b) => b.type === 'assembler')) return 'an assembler'
  if (byPress && !built.some((b) => b.type === 'press')) return 'a press'
  return null
}

const MACHINES: ReadonlySet<string> = new Set(['press', 'assembler', 'splitter', 'merger'])

export function nextHint(input: CoachInput): Hint | null {
  const { level, snapshot, status, cost, hasErrors } = input

  // The error box is already saying something more specific than this could.
  if (hasErrors || snapshot === null) return null
  // Never talk over a running factory; let the player watch it.
  if (status === 'running') return null

  const sinks = snapshot.buildings.filter((b) => b.type === 'sink')
  const sources = snapshot.buildings.filter((b) => b.type === 'source')
  const built = snapshot.buildings.filter((b) => !isFixture(b))
  const target = level.target.type

  if (status === 'won') {
    const over = cost - level.par
    if (over < 0) return { id: 'won-under', tone: 'win', text: `Solved for ${cost} — ${-over} under par. Nobody had found that.` }
    if (over === 0) return { id: 'won-par', tone: 'win', text: `Solved at par. ${cost} exactly.` }
    return { id: 'won-over', tone: 'win', text: `Solved for ${cost}, which is +${over}. Par is ${level.par} — there is a cheaper factory in here.` }
  }

  if (status === 'jammed') {
    // A jam is somewhere holding an item it cannot pass on. Point at the first
    // such building rather than describing the concept. Machines hold theirs in
    // `output` and conveyors in `item`, so both count as holding something.
    const stuck = snapshot.buildings.find(
      (b) => b.type !== 'sink' && (b.output !== null || b.item !== null) && drains(snapshot, b).length === 0,
    )
    if (stuck) {
      return {
        id: `jam-nowhere-${stuck.x}-${stuck.y}`,
        tone: 'problem',
        at: posOf(stuck),
        text: `${opening(name(stuck))} has something to hand on and nowhere to hand it. Its output has to face the next building, and that building has to face back.`,
      }
    }
    const backedUp = snapshot.buildings.find((b) => b.type === 'conveyor' && b.item !== null)
    return {
      id: 'jam-backed-up',
      tone: 'problem',
      at: backedUp ? posOf(backedUp) : undefined,
      text: 'The line is backed up — everything has stopped moving. Something downstream is not taking what it is being given.',
    }
  }

  if (status === 'timeout') {
    const delivered = snapshot.delivered[target] ?? 0
    return delivered === 0
      ? { id: 'timeout-none', tone: 'problem', text: `Time ran out and nothing reached the sink. Follow the line from the source and find where it stops.` }
      : { id: 'timeout-some', tone: 'problem', text: `Time ran out at ${delivered} of ${level.target.count}. The factory works — it is just too slow.` }
  }

  if (built.length === 0) {
    return {
      id: 'empty',
      tone: 'guide',
      at: sources[0] ? posOf(sources[0]) : undefined,
      text: `Drag from the source to lay a belt. You need ${level.target.count} ${target} in the sink.`,
    }
  }

  // What am I even building? Worth saying before any wiring advice — and worth
  // re-checking as machines go down, because a board can be perfectly wired and
  // still incapable of making the thing the sink is asking for.
  if (!makeableNow(level, built).has(target)) {
    const missing = missingMachine(level, built)
    const advice = recipeAdvice(level)
    if (missing !== null) {
      return {
        id: `needs-${missing.replace(/\W+/g, '-')}`,
        tone: 'guide',
        text: `Nothing on the board makes ${target} yet — you need ${missing}. ${advice ?? ''}`.trim(),
      }
    }
    if (advice) {
      return {
        id: 'needs-chain',
        tone: 'guide',
        text: `Nothing on the board makes ${target} yet. ${advice}`,
      }
    }
  }

  // Only when *nothing at all* is being drawn — not merely when one source is
  // idle. A level may offer two sources while the cheapest factory splits one
  // of them and never touches the other, and that board is finished, not
  // broken. Asking "is any source idle?" called 74 of the 203 solvable pool
  // levels broken at the moment they were won, every one of them two-source
  // and none of them one-source, which is exactly why hand-built worlds never
  // showed it.
  //
  // The masking was the worse half. This branch sits above the sink checks, so
  // on 50 of those levels a belt turned away from the sink — the four-in-five
  // bug itself — was reported as an idle source, and the one lesson the game
  // hinges on never got shown.
  //
  // A player who has wired one arm of a two-source level and stalled is not
  // left without help: the assembler waiting on its second input trips the
  // starved branch below, which points at the machine rather than the source.
  const idleSources = sources.filter((s) => drains(snapshot, s).length === 0)
  if (idleSources.length > 0 && idleSources.length === sources.length) {
    const idle = idleSources[0]
    return {
      id: `source-idle-${idle.x}-${idle.y}`,
      tone: 'problem',
      at: posOf(idle),
      text: `Nothing is carrying ${idle.emits ?? 'anything'} away from the source yet. Start a drag on it.`,
    }
  }

  const starved = built.find((b) => MACHINES.has(b.type) && b.inPorts.some((d) => {
    const n = neighbourOf(b.x, b.y, d)
    const other = snapshot.buildings.find((o) => o.x === n.x && o.y === n.y)
    return other === undefined || !connects(other, b)
  }))
  if (starved) {
    return {
      id: `starved-${starved.x}-${starved.y}`,
      tone: 'problem',
      at: posOf(starved),
      text: `${opening(name(starved))} has an input with nothing feeding it. Turn it, or run a belt into that side.`,
    }
  }

  const sink = sinks[0]
  if (sink && feeds(snapshot, sink).length === 0) {
    const nearby = touching(snapshot, sink).find((b) => !isFixture(b))
    // The lesson the whole game hinges on, taught at the moment it bites.
    if (nearby) {
      return {
        id: `sink-not-facing-${nearby.x}-${nearby.y}`,
        tone: 'problem',
        at: posOf(nearby),
        text: `${opening(name(nearby))} is next to the sink but not pointing at it. Drag onto the sink itself and the belt turns to face it.`,
      }
    }
    return {
      id: 'sink-unfed',
      tone: 'problem',
      at: posOf(sink),
      text: 'Nothing reaches the sink yet. The last belt has to run into it.',
    }
  }

  return {
    id: 'ready',
    tone: 'guide',
    text: `Everything is connected. Press Run and watch it — you are scored on cost, and par is ${level.par}.`,
  }
}
