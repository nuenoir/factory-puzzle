/**
 * Candidate proposal. docs/generation-spec.md §2, §7.
 *
 * The generator *constructs* chemistry that chains — it does not *screen* its
 * own output. Those are different things, and the distinction is what keeps
 * the rejection log worth reading. Building a recipe chain forward from the
 * sources is competence; running the validator and discarding failures would
 * be laundering, and would make stage A dead code.
 *
 * So it still proposes plenty the validator throws out: a chain the level has
 * no machine for, one too cheap to be a puzzle, one with only a single idea in
 * it. Those rejections are real, and they are the artifact.
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

/** Opaque to the engine (§3), so these are only labels. */
const TYPE_POOL: readonly ItemType[] = ['ore', 'ingot', 'plate', 'gear', 'rod', 'cog', 'widget', 'gadget']

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
  const chance = (p: number) => random() < p
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]

  // A seeded shuffle, so distinct type names can be drawn without collisions.
  const names = [...TYPE_POOL]
  for (let i = names.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[names[i], names[j]] = [names[j], names[i]]
  }
  let nextName = 0
  const freshType = () => names[nextName++] ?? `type${nextName}`

  const size = between(options.minGrid, options.maxGrid)
  const rows = Array.from({ length: size }, (_, i) => i)

  // Build a press chain forward from what the source emits, so the chemistry
  // actually goes somewhere.
  const base = freshType()
  const press: Record<ItemType, ItemType> = {}
  let deepest = base
  const chainLength = between(1, 2)
  for (let i = 0; i < chainLength; i += 1) {
    const next = freshType()
    press[deepest] = next
    deepest = next
  }

  // A second source sometimes supplies its own input to the assembler.
  const secondSourceType = chance(0.35) ? freshType() : null
  if (secondSourceType !== null && chance(0.5)) {
    // Give it a step of its own so the two arms are not symmetrical.
    const refined = freshType()
    press[secondSourceType] = refined
  }

  const assembler: AssemblerRecipe[] = []
  let target = deepest
  if (chance(0.8)) {
    const output = freshType()
    // Two of the same item is the level-001 shape, and the only one that
    // creates the press-then-split versus split-then-press choice — which is
    // what criterion 4 is looking for.
    const pair: [ItemType, ItemType] =
      secondSourceType !== null && chance(0.45)
        ? [deepest, press[secondSourceType] ?? secondSourceType]
        : [deepest, deepest]
    assembler.push({ in: pair, out: output })
    target = output
  }

  const sourceRows: number[] = []
  const wanted = secondSourceType === null ? 1 : 2
  while (sourceRows.length < wanted) {
    const row = pick(rows)
    if (!sourceRows.includes(row)) sourceRows.push(row)
  }
  const emits = [base, ...(secondSourceType === null ? [] : [secondSourceType])]

  // The machines are usually offered, but not always. A chain with no press
  // is genuinely unsolvable, and stage A should be the one to say so.
  const available: PlaceableType[] = ['conveyor']
  if (chance(0.9)) available.push('press')
  if (assembler.length > 0 && chance(0.9)) available.push('assembler')
  if (chance(0.75)) available.push('splitter')
  if (chance(0.4)) available.push('merger')

  return {
    id: `gen-${seed}`,
    grid: { width: size, height: size },
    sources: sourceRows.map((y, i) => ({
      pos: [0, y] as PosTuple,
      rotation: 0 as const,
      emits: emits[i],
    })),
    sinks: [{ pos: [size - 1, pick(rows)] as PosTuple, rotation: 0 as const }],
    target: { type: target, count: 5 },
    max_ticks: 300,
    available,
    recipes: { press, assembler },
    // §2 — par is computed by the validator, never proposed.
    par: 0,
  }
}
