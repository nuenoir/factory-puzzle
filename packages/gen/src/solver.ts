/**
 * Placement search. docs/generation-spec.md §4 stage C.
 *
 * Plans say which machines a factory needs; the router wires them once placed.
 * This decides *where* they go, which is the combinatorial part and therefore
 * the bounded one.
 *
 * The search is seeded random restarts with a west-to-east bias, because flow
 * runs that way. It is deliberately simple: the roadmap time-boxes this, and a
 * cleverer search should be earned by evidence from the rejection log rather
 * than guessed at up front. Every bound is reported, so `no solution found`
 * never masquerades as `unsolvable` (§4).
 */

import {
  DIRECTIONS,
  ROTATIONS,
  portsFor,
  simulate,
  type Direction,
  type Level,
  type Placement,
  type PlaceableType,
  type PosTuple,
  type Rotation,
  type Solution,
} from '@factory/sim'

import { routeBelts } from './router.ts'
import {
  canonicalPlan,
  enumeratePlans,
  DEFAULT_PLAN_LIMITS,
  type Plan,
  type PlanLimits,
  type PlanNode,
} from './planner.ts'

/**
 * Every cap stage C is subject to. §4 requires all of them in the log, because
 * an empty search is only interpretable next to what it was allowed to do — and
 * the two plan caps bound a different thing from the two attempt caps, which is
 * why `no_plan_within_depth` and `no_placement_found` are separate verdicts.
 */
export interface SearchLimits extends PlanLimits {
  /** Random restarts tried per plan. Each one places every machine afresh. */
  readonly attemptsPerPlan: number
  /**
   * Wiring passes per placement before the placement itself is abandoned.
   *
   * Machines land, and then one belt run cannot find a lane — but the placement
   * was fine and only the wiring was unlucky. Re-pairing the ports and re-
   * ordering the belt runs is far cheaper than finding somewhere new to put
   * everything, so it is worth a few goes first. 1 reproduces the original
   * behaviour exactly, where any routing failure discarded the whole attempt.
   *
   * 2 was measured, not guessed. Over 200 candidates across four independent
   * seed ranges it took accepted from 10 to 23, winning in all four when paired
   * by range. 4 tied it on acceptance and cost 40% more wall clock. See §4 of
   * the generation spec for the numbers and for why the gain is not where you
   * would expect it.
   */
  readonly routeRetries: number
  /** Wall-clock ceiling for the whole search. */
  readonly timeoutMs: number
}

export const DEFAULT_SEARCH_LIMITS: SearchLimits = {
  ...DEFAULT_PLAN_LIMITS,
  attemptsPerPlan: 250,
  routeRetries: 2,
  timeoutMs: 4000,
}

/** Where an attempt died. Aggregated so the search can be tuned on evidence. */
export interface AttemptTally {
  /** Could not find free cells for every machine. */
  placement: number
  /** A required port did not exist at the chosen rotation. */
  ports: number
  /** No belt lane between two ports. */
  routing: number
  /** Laid out fine, but the factory did not deliver. */
  simulation: number
  won: number
}

export interface SolveOutcome {
  /** One verified winning solution per distinct plan, cheapest kept. */
  readonly solutions: readonly { plan: Plan; solution: Solution; cost: number }[]
  /** The cheapest verified solution overall, or null if none was found. */
  readonly cheapest: { plan: Plan; solution: Solution; cost: number } | null
  /** §5 — how many materially different solutions were verified. */
  readonly distinctForms: number
  /** True when every plan ran its full allowance without being cut short. */
  readonly exhausted: boolean
  readonly plansTried: number
  readonly attempts: number
  readonly tally: AttemptTally
}

/** Deterministic PRNG. §7 requires a batch to reproduce from its seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** odd-r offset to axial, so directions can be compared as vectors. */
function toAxial(x: number, y: number): { q: number; r: number } {
  return { q: x - ((y - (y & 1)) >> 1), r: y }
}

const AXIAL_STEP: Readonly<Record<Direction, { q: number; r: number }>> = {
  E: { q: 1, r: 0 },
  SE: { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
  W: { q: -1, r: 0 },
  NW: { q: 0, r: -1 },
  NE: { q: 1, r: -1 },
}

/** The direction from `from` that points most nearly at `to`. */
function directionToward(from: PosTuple, to: PosTuple): Direction {
  const a = toAxial(from[0], from[1])
  const b = toAxial(to[0], to[1])
  const dq = b.q - a.q
  const dr = b.r - a.r
  const ds = -dq - dr

  let best: Direction = 'E'
  let bestScore = -Infinity
  for (const d of DIRECTIONS) {
    const v = AXIAL_STEP[d]
    const vs = -v.q - v.r
    const score = dq * v.q + dr * v.r + ds * vs
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

interface Edge {
  readonly from: number
  fromPort: number
  readonly to: number
  toPort: number
}

/**
 * Which port of which node feeds which. A splitter feeding both assembler
 * ports appears twice, taking a different output port each time — that is how
 * the shared-feed plan becomes two real connections.
 */
function edgesOf(plan: Plan): Edge[] {
  const used = new Map<number, number>()
  const edges: Edge[] = []
  for (const node of plan.nodes) {
    node.inputs.forEach((fromId, toPort) => {
      const fromPort = used.get(fromId) ?? 0
      used.set(fromId, fromPort + 1)
      edges.push({ from: fromId, fromPort, to: node.id, toPort })
    })
  }
  return edges
}

/**
 * Which output feeds which input is not determined by the plan — a splitter
 * supplies an assembler's two ports, but nothing says which goes where.
 *
 * It matters enormously. One pairing sends the two belt runs down opposite
 * sides; the other makes them cross, and a hex grid has no crossings, so every
 * layout fails to route. Flipping it at random lets restarts explore both.
 */
function shufflePortPairing(edges: readonly Edge[], random: () => number): Edge[] {
  const flipped = edges.map((e) => ({ ...e }))

  const flip = (group: { p: number }[]) => {
    if (group.length === 2 && random() < 0.5) {
      const first = group[0].p
      group[0].p = group[1].p
      group[1].p = first
    }
  }

  const outputs = new Map<number, { p: number }[]>()
  const inputs = new Map<number, { p: number }[]>()
  flipped.forEach((e) => {
    const outRef = { get p() { return e.fromPort }, set p(v: number) { e.fromPort = v } }
    const inRef = { get p() { return e.toPort }, set p(v: number) { e.toPort = v } }
    ;(outputs.get(e.from) ?? outputs.set(e.from, []).get(e.from)!).push(outRef)
    ;(inputs.get(e.to) ?? inputs.set(e.to, []).get(e.to)!).push(inRef)
  })

  for (const group of outputs.values()) flip(group)
  for (const group of inputs.values()) flip(group)
  return flipped
}

/** Longest distance from a source, used to spread machines west to east. */
function depthsOf(plan: Plan): Map<number, number> {
  const depth = new Map<number, number>()
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  const visit = (id: number, guard: ReadonlySet<number>): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    if (guard.has(id)) return 0
    const node = byId.get(id)
    if (!node || node.inputs.length === 0) {
      depth.set(id, 0)
      return 0
    }
    const deeper = new Set(guard).add(id)
    const d = 1 + Math.max(...node.inputs.map((i) => visit(i, deeper)))
    depth.set(id, d)
    return d
  }
  for (const node of plan.nodes) visit(node.id, new Set())
  return depth
}

const key = (p: PosTuple) => `${p[0]},${p[1]}`

/** Ports of a placed node, honouring the level's fixed source/sink rotations. */
function portsOf(node: PlanNode, level: Level, rotation: Rotation) {
  if (node.kind === 'source') {
    const source = level.sources[node.sourceIndex ?? 0]
    return portsFor('source', source.rotation)
  }
  if (node.kind === 'sink') return portsFor('sink', level.sinks[0].rotation)
  return portsFor(node.kind as Exclude<PlaceableType, 'conveyor'>, rotation)
}

type AttemptResult =
  | { readonly ok: true; readonly solution: Solution }
  | { readonly ok: false; readonly stage: keyof Omit<AttemptTally, 'won'> }

/**
 * Try to realise one plan as a real layout. Succeeds only when `simulate` says
 * the factory wins — routing successfully is not the same as working.
 */
function attempt(level: Level, plan: Plan, random: () => number, retries: number): AttemptResult {
  const { width, height } = level.grid
  const depths = depthsOf(plan)
  const maxDepth = Math.max(1, ...depths.values())

  const fixed = new Map<number, PosTuple>()
  for (const node of plan.nodes) {
    if (node.kind === 'source') fixed.set(node.id, level.sources[node.sourceIndex ?? 0].pos)
    if (node.kind === 'sink') fixed.set(node.id, level.sinks[0].pos)
  }

  const taken = new Set<string>()
  for (const s of [...level.sources, ...level.sinks]) taken.add(key(s.pos))

  // Machines sit in a corridor between the source and the sink: the column
  // follows their depth in the flow, the row interpolates between the two
  // fixtures. Scattering them uniformly wastes most attempts on layouts whose
  // belts cannot reach.
  const startRow = level.sources[0]?.pos[1] ?? Math.floor(height / 2)
  const endRow = level.sinks[0]?.pos[1] ?? Math.floor(height / 2)

  const cells = new Map<number, PosTuple>(fixed)
  for (const node of plan.nodes) {
    if (cells.has(node.id)) continue
    const t = (depths.get(node.id) ?? 1) / (maxDepth + 1)
    const idealX = t * (width - 1)
    const idealY = startRow + (endRow - startRow) * t

    let placed: PosTuple | null = null
    for (let tries = 0; tries < 40 && placed === null; tries += 1) {
      const spread = 1 + tries / 12 // widen the net if the neighbourhood is full
      const x = clamp(Math.round(idealX + (random() * 2 - 1) * (1 + spread)), 0, width - 1)
      const y = clamp(Math.round(idealY + (random() * 2 - 1) * (1 + spread)), 0, height - 1)
      if (!taken.has(key([x, y]))) placed = [x, y]
    }
    if (placed === null) return { ok: false, stage: 'placement' }
    taken.add(key(placed))
    cells.set(node.id, placed)
  }

  const byId = new Map(plan.nodes.map((n) => [n.id, n]))

  // The machines are down. Everything below is wiring, and wiring is cheap to
  // redo compared with finding somewhere new to put a factory — so a run that
  // cannot find a lane gets the pairing and the belt order shuffled and tries
  // again, rather than throwing the placement away with it.
  let lastFailure: AttemptResult = { ok: false, stage: 'routing' }
  for (let retry = 0; retry < Math.max(1, retries); retry += 1) {
    const wired = wire(level, plan, cells, taken, byId, random)
    if (wired.ok) return wired
    lastFailure = wired
    // A missing port is a property of the plan and the placement, not of this
    // wiring pass. Shuffling again would fail identically.
    if (wired.stage === 'ports') break
  }
  return lastFailure
}

/**
 * One wiring pass over a fixed placement: pair the ports, orient the machines,
 * lay the belts, and let `simulate` say whether the result is a factory.
 */
function wire(
  level: Level,
  plan: Plan,
  cells: ReadonlyMap<number, PosTuple>,
  taken: ReadonlySet<string>,
  byId: ReadonlyMap<number, PlanNode>,
  random: () => number,
): AttemptResult {
  const edges = shufflePortPairing(edgesOf(plan), random)

  // Orient each machine so its ports point roughly at what they connect to.
  const rotations = new Map<number, Rotation>()
  for (const node of plan.nodes) {
    if (node.kind === 'source' || node.kind === 'sink') continue
    const here = cells.get(node.id) as PosTuple
    const wants: { port: 'in' | 'out'; index: number; ideal: Direction }[] = []
    edges.forEach((e) => {
      if (e.from === node.id) wants.push({ port: 'out', index: e.fromPort, ideal: directionToward(here, cells.get(e.to) as PosTuple) })
      if (e.to === node.id) wants.push({ port: 'in', index: e.toPort, ideal: directionToward(here, cells.get(e.from) as PosTuple) })
    })

    const scored = ROTATIONS.map((rotation) => {
      const ports = portsFor(node.kind as Exclude<PlaceableType, 'conveyor'>, rotation)
      let score = 0
      for (const want of wants) {
        const actual = want.port === 'out' ? ports.out[want.index] : ports.in[want.index]
        if (actual === undefined) continue
        const v = AXIAL_STEP[actual]
        const w = AXIAL_STEP[want.ideal]
        score += v.q * w.q + v.r * w.r + (-v.q - v.r) * (-w.q - w.r)
      }
      return { rotation, score }
    }).sort((a, b) => b.score - a.score)

    // Best alignment, always. Sampling the runners-up was tried and measurably
    // hurt: no_solution_found rose from 23 to 29 across the same 50 candidates,
    // because attempts spent on worse orientations are attempts not spent on
    // fresh placements.
    rotations.set(node.id, scored[0].rotation)
  }

  const machines: Placement[] = []
  for (const node of plan.nodes) {
    if (node.kind === 'source' || node.kind === 'sink') continue
    machines.push({
      type: node.kind as PlaceableType,
      pos: cells.get(node.id) as PosTuple,
      rotation: rotations.get(node.id) ?? 0,
    })
  }

  // Belts claim cells first-come-first-served, so an unlucky order can wall in
  // a later run. Vary it, or the same order fails the same way every restart.
  const order = edges.map((edge, i) => ({ edge, key: random(), i }))
  order.sort((a, b) => a.key - b.key)

  const occupied = new Set(taken)
  const belts: Placement[] = []
  for (const { edge } of order) {
    const fromNode = byId.get(edge.from)
    const toNode = byId.get(edge.to)
    if (!fromNode || !toNode) return { ok: false, stage: 'ports' }

    const fromPorts = portsOf(fromNode, level, rotations.get(edge.from) ?? 0)
    const toPorts = portsOf(toNode, level, rotations.get(edge.to) ?? 0)
    const outDir = fromPorts.out[edge.fromPort]
    const inDir = toPorts.in[edge.toPort]
    if (outDir === undefined || inDir === undefined) return { ok: false, stage: 'ports' }

    const leg = routeBelts(
      level.grid,
      occupied,
      { pos: cells.get(edge.from) as PosTuple, dir: outDir },
      { pos: cells.get(edge.to) as PosTuple, dir: inDir },
    )
    if (leg === null) return { ok: false, stage: 'routing' }
    for (const belt of leg) {
      occupied.add(key(belt.pos))
      belts.push(belt)
    }
  }

  const solution: Solution = { level_id: level.id, placements: [...machines, ...belts] }
  // The router only found lanes. Winning is the simulator's call (CLAUDE.md).
  return simulate(level, solution).won ? { ok: true, solution } : { ok: false, stage: 'simulation' }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * §4 stage C. Search each plan for a layout that actually wins.
 *
 * Plans are tried cheapest first, so an early timeout still leaves the best
 * answer found rather than an arbitrary one.
 */
export function solve(
  level: Level,
  seed: number,
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
  now: () => number = Date.now,
): SolveOutcome {
  // The plan caps are part of the bound now, so they have to come from the
  // limits rather than from the enumerator's own defaults — otherwise the log
  // would report a cap the search did not actually run under.
  const plans = enumeratePlans(level, limits)
  const random = mulberry32(seed)
  const deadline = now() + limits.timeoutMs

  const bestByForm = new Map<string, { plan: Plan; solution: Solution; cost: number }>()
  const tally: AttemptTally = { placement: 0, ports: 0, routing: 0, simulation: 0, won: 0 }
  let attempts = 0
  let plansTried = 0
  let exhausted = true

  for (const plan of plans) {
    plansTried += 1
    for (let i = 0; i < limits.attemptsPerPlan; i += 1) {
      if (now() >= deadline) {
        exhausted = false
        break
      }
      attempts += 1
      const result = attempt(level, plan, random, limits.routeRetries)
      if (!result.ok) {
        tally[result.stage] += 1
        continue
      }
      tally.won += 1

      const cost = simulate(level, result.solution).cost
      const form = canonicalPlan(plan)
      const incumbent = bestByForm.get(form)
      if (incumbent === undefined || cost < incumbent.cost) {
        bestByForm.set(form, { plan, solution: result.solution, cost })
      }
    }
    if (!exhausted) break
  }

  const solutions = [...bestByForm.values()].sort((a, b) => a.cost - b.cost)
  return {
    solutions,
    cheapest: solutions[0] ?? null,
    distinctForms: solutions.length,
    exhausted,
    plansTried,
    attempts,
    tally,
  }
}
