/**
 * Plan enumeration and canonical form. docs/generation-spec.md §4 stage C, §5.
 *
 * A plan is *what* a factory does — which machines exist and what feeds what —
 * with no positions in it. Searching over plans rather than over cells is what
 * keeps stage C tractable: the recipe DAG admits a handful of plans, while the
 * grid admits astronomically many placements.
 *
 * It is also where level 001's lesson lives. An assembler wanting two of the
 * same item can be fed by two producer chains, or by one chain and a splitter.
 * Those are different plans, and telling them apart is exactly what §5's
 * "materially different" criterion is for.
 */

import { COST, type ItemType, type Level, type PlaceableType } from '@factory/sim'

export type PlanNodeKind = 'source' | 'press' | 'assembler' | 'splitter' | 'sink'

export interface PlanNode {
  readonly id: number
  readonly kind: PlanNodeKind
  /** The item type leaving this node. */
  readonly item: ItemType
  /** Ids feeding it, in port order. The same id twice means a shared feed. */
  readonly inputs: readonly number[]
  /** Which of the level's sources this is, for `source` nodes. */
  readonly sourceIndex?: number
}

export interface Plan {
  readonly nodes: readonly PlanNode[]
  /** Machines only. Belts depend on placement and are counted after routing. */
  readonly machineCost: number
}

interface Fragment {
  readonly nodes: readonly PlanNode[]
  readonly rootId: number
}

export interface PlanLimits {
  /** How deep a recipe chain may go before the search gives up. */
  readonly maxDepth: number
  /** Cap on plans returned, so a rich recipe table cannot explode. */
  readonly maxPlans: number
}

export const DEFAULT_PLAN_LIMITS: PlanLimits = { maxDepth: 4, maxPlans: 40 }

const MACHINE_KINDS: ReadonlySet<PlanNodeKind> = new Set(['press', 'assembler', 'splitter'])

/** Re-id `fragment` so it can sit alongside `base`, and append it. */
function append(base: readonly PlanNode[], fragment: Fragment): { nodes: PlanNode[]; rootId: number } {
  const offset = base.length
  const shifted = fragment.nodes.map((n) => ({
    ...n,
    id: n.id + offset,
    inputs: n.inputs.map((i) => i + offset),
  }))
  return { nodes: [...base, ...shifted], rootId: fragment.rootId + offset }
}

/**
 * Every way this level's chemistry can produce `item`, as fragments.
 *
 * Bounded by depth, and by refusing to revisit a type already on the current
 * chain — a recipe cycle would otherwise recurse forever.
 */
function fragmentsFor(
  level: Level,
  item: ItemType,
  depth: number,
  chain: ReadonlySet<ItemType>,
  limits: PlanLimits,
): Fragment[] {
  const out: Fragment[] = []

  level.sources.forEach((source, sourceIndex) => {
    if (source.emits === item) {
      out.push({ nodes: [{ id: 0, kind: 'source', item, inputs: [], sourceIndex }], rootId: 0 })
    }
  })

  if (depth >= limits.maxDepth || chain.has(item)) return out
  const deeper = new Set(chain).add(item)

  const canUse = (type: PlaceableType) => level.available.includes(type)

  if (canUse('press')) {
    for (const [input, output] of Object.entries(level.recipes.press ?? {})) {
      if (output !== item) continue
      for (const upstream of fragmentsFor(level, input, depth + 1, deeper, limits)) {
        const merged = append([], upstream)
        const id = merged.nodes.length
        out.push({
          nodes: [...merged.nodes, { id, kind: 'press', item, inputs: [merged.rootId] }],
          rootId: id,
        })
      }
    }
  }

  if (canUse('assembler')) {
    for (const recipe of level.recipes.assembler ?? []) {
      if (recipe.out !== item) continue
      const [a, b] = recipe.in

      if (a === b) {
        // One chain feeding both ports through a splitter — cheaper whenever a
        // producer costs more than the splitter, which is the level-001 lesson.
        if (canUse('splitter')) {
          for (const shared of fragmentsFor(level, a, depth + 1, deeper, limits)) {
            const merged = append([], shared)
            const splitterId = merged.nodes.length
            const withSplitter = [
              ...merged.nodes,
              { id: splitterId, kind: 'splitter' as const, item: a, inputs: [merged.rootId] },
            ]
            const assemblerId = withSplitter.length
            out.push({
              nodes: [
                ...withSplitter,
                { id: assemblerId, kind: 'assembler' as const, item, inputs: [splitterId, splitterId] },
              ],
              rootId: assemblerId,
            })
          }
        }

        // Or two independent chains, one per port.
        for (const left of fragmentsFor(level, a, depth + 1, deeper, limits)) {
          for (const right of fragmentsFor(level, b, depth + 1, deeper, limits)) {
            const first = append([], left)
            const second = append(first.nodes, right)
            const id = second.nodes.length
            out.push({
              nodes: [...second.nodes, { id, kind: 'assembler', item, inputs: [first.rootId, second.rootId] }],
              rootId: id,
            })
          }
        }
        continue
      }

      for (const left of fragmentsFor(level, a, depth + 1, deeper, limits)) {
        for (const right of fragmentsFor(level, b, depth + 1, deeper, limits)) {
          const first = append([], left)
          const second = append(first.nodes, right)
          const id = second.nodes.length
          out.push({
            nodes: [...second.nodes, { id, kind: 'assembler', item, inputs: [first.rootId, second.rootId] }],
            rootId: id,
          })
        }
      }
    }
  }

  return out
}

export function machineCostOf(nodes: readonly PlanNode[]): number {
  return nodes
    .filter((n) => MACHINE_KINDS.has(n.kind))
    .reduce((sum, n) => sum + COST[n.kind as PlaceableType], 0)
}

/**
 * Every plan that could deliver the level's target, cheapest first.
 *
 * Cheapest first matters: stage C reports the cheapest solution it found as
 * the level's par (§2), so trying cheap plans first means an early timeout
 * still yields the best answer available rather than an arbitrary one.
 */
export function enumeratePlans(level: Level, limits: PlanLimits = DEFAULT_PLAN_LIMITS): Plan[] {
  const plans = fragmentsFor(level, level.target.type, 0, new Set(), limits).map((fragment) => {
    const sinkId = fragment.nodes.length
    const nodes: PlanNode[] = [
      ...fragment.nodes,
      { id: sinkId, kind: 'sink', item: level.target.type, inputs: [fragment.rootId] },
    ]
    return { nodes, machineCost: machineCostOf(nodes) }
  })

  const seen = new Set<string>()
  return plans
    .filter((plan) => {
      const form = canonicalPlan(plan)
      if (seen.has(form)) return false
      seen.add(form)
      return true
    })
    .sort((a, b) => a.machineCost - b.machineCost || canonicalPlan(a).localeCompare(canonicalPlan(b)))
    .slice(0, limits.maxPlans)
}

/**
 * §5. A plan's identity: its machine multiset plus its item-flow graph, with
 * positions and belt geometry discarded.
 *
 * Two solutions are materially different exactly when these differ. Level 001
 * is the worked example — press-then-split and split-then-press use different
 * machines, so they count; the same plan laid out with a wigglier belt
 * canonicalises identically and does not.
 */
export function canonicalPlan(plan: Plan): string {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))

  const machines = plan.nodes
    .filter((n) => MACHINE_KINDS.has(n.kind))
    .map((n) => n.kind)
    .sort()

  const edges = plan.nodes
    .flatMap((node) =>
      node.inputs.map((inputId) => {
        const from = byId.get(inputId)
        return `${from?.kind ?? '?'}:${from?.item ?? '?'}->${node.kind}`
      }),
    )
    .sort()

  return JSON.stringify({ machines, edges })
}
