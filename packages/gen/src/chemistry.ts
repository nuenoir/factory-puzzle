/**
 * Stages A and B of the validator. docs/generation-spec.md §4.
 *
 * Both ignore the grid entirely and are exact, which is the point: they reject
 * most malformed candidates for microseconds, so a 50-candidate batch never
 * pays for a placement search it did not need.
 */

import { COST, type ItemType, type Level } from '@factory/sim'

/** A machine that produces a type. Splitters and mergers produce nothing. */
export type ProducerType = 'press' | 'assembler'

/**
 * §4 stage A. Every item type the level's chemistry can reach from its
 * sources, by closing over the recipe tables until nothing new appears.
 *
 * An assembler pair of the same type (`disc + disc`) needs that type reachable
 * only once: one producer feeding a splitter supplies both ports over time,
 * which is exactly the lesson level 001 is built around.
 */
export function reachableTypes(level: Level): Set<ItemType> {
  const reachable = new Set<ItemType>(level.sources.map((s) => s.emits))
  const press = level.recipes.press ?? {}
  const assemblers = level.recipes.assembler ?? []

  for (let grew = true; grew; ) {
    grew = false

    for (const type of [...reachable]) {
      const out = press[type]
      if (out !== undefined && !reachable.has(out)) {
        reachable.add(out)
        grew = true
      }
    }

    for (const recipe of assemblers) {
      const [a, b] = recipe.in
      const ready = reachable.has(a) && reachable.has(b)
      if (ready && !reachable.has(recipe.out)) {
        reachable.add(recipe.out)
        grew = true
      }
    }
  }

  return reachable
}

/** §4 stage A. Provably unsolvable when the target is out of reach. */
export function isProducible(level: Level): boolean {
  return reachableTypes(level).has(level.target.type)
}

export interface MachineFloor {
  /** A lower bound on the cost of any solution. */
  readonly cost: number
  /** One producing machine per distinct type that has to be made. */
  readonly machines: ReadonlyMap<ItemType, ProducerType>
}

/**
 * §4 stage B. The cheapest set of producing machines that could make the
 * target, and hence a lower bound on the cost of any solution.
 *
 * It is a *lower* bound because it counts each distinct type's producer once
 * and ignores conveyors and splitters entirely — both of which only ever add
 * cost. So a candidate whose floor already exceeds the budget can be rejected
 * without placing anything, and that rejection is sound.
 *
 * Counting per distinct type rather than per derivation step is what keeps it
 * honest: `disc + disc -> widget` needs one press, not two, because a splitter
 * can fan one press's output into both assembler ports.
 */
export function machineFloor(level: Level): MachineFloor | null {
  const press = level.recipes.press ?? {}
  const assemblers = level.recipes.assembler ?? []
  const sourceTypes = new Set<ItemType>(level.sources.map((s) => s.emits))

  const costOf = (machines: ReadonlyMap<ItemType, ProducerType>): number =>
    [...machines.values()].reduce((sum, m) => sum + COST[m], 0)

  /** Cheapest producer set for `type`, or null if it cannot be made. */
  const producersFor = (type: ItemType, visiting: ReadonlySet<ItemType>): Map<ItemType, ProducerType> | null => {
    if (sourceTypes.has(type)) return new Map()
    // A recipe cycle cannot bottom out at a source down this path.
    if (visiting.has(type)) return null

    const deeper = new Set(visiting).add(type)
    let best: Map<ItemType, ProducerType> | null = null

    const consider = (candidate: Map<ItemType, ProducerType> | null) => {
      if (candidate === null) return
      if (best === null || costOf(candidate) < costOf(best)) best = candidate
    }

    for (const [input, output] of Object.entries(press)) {
      if (output !== type) continue
      const upstream = producersFor(input, deeper)
      if (upstream === null) continue
      consider(new Map(upstream).set(type, 'press'))
    }

    for (const recipe of assemblers) {
      if (recipe.out !== type) continue
      const [a, b] = recipe.in
      const left = producersFor(a, deeper)
      if (left === null) continue
      const right = producersFor(b, deeper)
      if (right === null) continue
      // Union, so a pair of the same type counts its producer once.
      consider(new Map([...left, ...right]).set(type, 'assembler'))
    }

    return best
  }

  const machines = producersFor(level.target.type, new Set())
  if (machines === null) return null
  return { cost: costOf(machines), machines }
}
