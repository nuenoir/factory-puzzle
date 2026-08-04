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
  // A recipe the level does not offer the machine for is not a route to
  // anything. Gating here keeps stage A's "provably unsolvable" honest, and
  // catches for free what would otherwise cost a whole bounded search.
  const press = level.available.includes('press') ? (level.recipes.press ?? {}) : {}
  const assemblers = level.available.includes('assembler') ? (level.recipes.assembler ?? []) : []

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

/**
 * §4 stage B. Can the target be built without ever fanning one output into two
 * consumers? Only meaningful when the level offers no splitter — with one, a
 * chain of them supplies any fan-out a plan asks for.
 *
 * Stage A asks only whether the target *type* is reachable, which ignores how
 * many items a building can hand out at once. Every building in the palette has
 * exactly one output port except the splitter (rules-spec §4), so without one
 * the factory must be a strict tree, and each leaf of that tree has to be a
 * *different* source — one source, one port, one consumer.
 *
 * So the question reduces to: is there a derivation of the target whose leaves
 * are distinct sources? Track the set of source indices each derivation
 * consumes as a bitmask; an assembler may combine two arms only when their
 * masks are disjoint, because a shared source would have to feed both.
 *
 * Deliberately *not* depth-bounded. This answer is reported as a proof, and a
 * depth limit would turn "we did not look far enough" into "impossible" — the
 * exact conflation the whole rejection-code scheme exists to prevent. Refusing
 * to revisit a type already on the current chain is what makes it terminate,
 * and that is sound here: a derivation that loops back to a type it already
 * made can always be cut short at the inner occurrence, which yields a *subset*
 * of the leaves. Fewer leaves can only make repeat-freeness easier, so nothing
 * feasible is ever hidden by the cut.
 */
export function deliverableWithoutFanout(level: Level): boolean {
  const press = level.available.includes('press') ? (level.recipes.press ?? {}) : {}
  const assemblers = level.available.includes('assembler') ? (level.recipes.assembler ?? []) : []

  /** Source-index bitmasks reachable for `type` using each source at most once. */
  const masksFor = (type: ItemType, chain: ReadonlySet<ItemType>): Set<number> => {
    const masks = new Set<number>()
    level.sources.forEach((source, index) => {
      if (source.emits === type) masks.add(1 << index)
    })
    if (chain.has(type)) return masks

    const deeper = new Set(chain).add(type)

    for (const [input, output] of Object.entries(press)) {
      if (output !== type) continue
      // A press passes its arm's sources straight through — one in, one out.
      for (const mask of masksFor(input, deeper)) masks.add(mask)
    }

    for (const recipe of assemblers) {
      if (recipe.out !== type) continue
      const [a, b] = recipe.in
      const left = masksFor(a, deeper)
      if (left.size === 0) continue
      const right = masksFor(b, deeper)
      for (const l of left) {
        for (const r of right) {
          // Overlapping masks mean one source would have to feed both arms,
          // which is precisely the fan-out no splitter is available for.
          if ((l & r) === 0) masks.add(l | r)
        }
      }
    }

    return masks
  }

  return masksFor(level.target.type, new Set()).size > 0
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
  const press = level.available.includes('press') ? (level.recipes.press ?? {}) : {}
  const assemblers = level.available.includes('assembler') ? (level.recipes.assembler ?? []) : []
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
