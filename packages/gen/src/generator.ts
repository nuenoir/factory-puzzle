/**
 * Candidate proposal. docs/generation-spec.md §2, §7.
 *
 * The generator proposes; the validator disposes. It deliberately does not
 * screen its own output for reachability or cost — pre-filtering would make
 * stage A dead code and hollow out the rejection log, and the breakdown is
 * only worth reading if the generator was genuinely allowed to be wrong.
 *
 * All randomness in this project lives here, seeded, because `packages/sim/`
 * has none by rule. A candidate reproduces from its seed alone (§7).
 */

import type { AssemblerRecipe, ItemType, Level, PlaceableType, PosTuple } from '@factory/sim'

/** Deterministic PRNG; the same generator the solver uses. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Opaque to the engine (§3), so these are only labels. A small pool keeps
 * recipe tables dense enough that chains actually form.
 */
const TYPE_POOL: readonly ItemType[] = ['ore', 'ingot', 'plate', 'gear', 'rod', 'widget']

export interface GeneratorOptions {
  readonly minGrid: number
  readonly maxGrid: number
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = { minGrid: 5, maxGrid: 7 }

export function generateLevel(
  seed: number,
  options: GeneratorOptions = DEFAULT_GENERATOR_OPTIONS,
): Level {
  const random = mulberry32(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))

  const size = between(options.minGrid, options.maxGrid)
  const grid = { width: size, height: size }

  // Sources on the west edge, sink on the east, so flow has somewhere to go.
  const rows = Array.from({ length: size }, (_, i) => i)
  const sourceCount = between(1, 2)
  const sourceRows: number[] = []
  while (sourceRows.length < sourceCount) {
    const row = pick(rows)
    if (!sourceRows.includes(row)) sourceRows.push(row)
  }

  const pool = TYPE_POOL.slice(0, between(3, TYPE_POOL.length))
  const sources = sourceRows.map((y) => ({
    pos: [0, y] as PosTuple,
    rotation: 0 as const,
    emits: pick(pool),
  }))
  const sinks = [{ pos: [size - 1, pick(rows)] as PosTuple, rotation: 0 as const }]

  // A press maps one type to another; no type may press to two things.
  const press: Record<ItemType, ItemType> = {}
  const pressCount = between(1, 3)
  for (let i = 0; i < pressCount; i += 1) {
    const from = pick(pool)
    const to = pick(pool)
    if (from !== to && press[from] === undefined) press[from] = to
  }

  // §3 rejects duplicate unordered pairs at load, so do not emit them.
  const assembler: AssemblerRecipe[] = []
  const seenPairs = new Set<string>()
  const assemblerCount = between(0, 2)
  for (let i = 0; i < assemblerCount; i += 1) {
    const a = pick(pool)
    const b = pick(pool)
    const out = pick(pool)
    const key = [a, b].sort().join('|')
    if (out === a || out === b || seenPairs.has(key)) continue
    seenPairs.add(key)
    assembler.push({ in: [a, b], out })
  }

  const optional: PlaceableType[] = ['splitter', 'merger', 'press', 'assembler']
  const available: PlaceableType[] = ['conveyor', ...optional.filter(() => random() < 0.75)]

  return {
    id: `gen-${seed}`,
    grid,
    sources,
    sinks,
    // Any type the recipes mention — not screened for reachability (§2).
    target: { type: pick(pool), count: 5 },
    max_ticks: 300,
    available,
    recipes: { press, assembler },
    // §2 — par is computed by the validator, never proposed. Zero until then.
    par: 0,
  }
}
