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
  /**
   * Sometimes offer a second recipe producing the target, so the puzzle has
   * more than one idea in it.
   *
   * §2 always allowed two assembler pairs; the generator only ever emitted one,
   * which meant the *only* structure that could satisfy criterion 4 was an
   * `x + x` pair with a splitter — press-then-split versus split-then-press.
   * Every level without that shape had exactly one plan and was rejected
   * `single_solution` no matter how well the search performed.
   *
   * This does not screen anything. A second route is proposed, not verified;
   * the validator still decides whether either route can be built (§2).
   *
   * Measured over 200 candidates: the accepted levels went from **2 distinct
   * machine shapes to 6**, and from 30 of 31 sharing one shape to a spread of
   * 12/10/4/4/4/2. That is the result worth having. Acceptance itself only
   * moved 31 → 36, which is the smaller half of the story.
   */
  readonly alternativeRoutes: boolean
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  minGrid: 5,
  maxGrid: 7,
  alternativeRoutes: true,
}

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
  if (secondSourceType !== null) {
    if (options.alternativeRoutes && chance(0.45)) {
      // Converge: the second chain makes the *same* item as the first. A press
      // table is keyed by input, so two inputs mapping to one output has always
      // been expressible — the generator just never wrote it.
      //
      // This is the cheapest real variety available. It gives the assembler a
      // route with no splitter in it at all (one chain per port), alongside the
      // split-one-chain routes, and those have different machine multisets, so
      // they are different ideas rather than mirror images of each other.
      press[secondSourceType] = deepest
    } else if (chance(0.5)) {
      // Give it a step of its own so the two arms are not symmetrical.
      const refined = freshType()
      press[secondSourceType] = refined
    }
  }

  const assembler: AssemblerRecipe[] = []
  let target = deepest
  if (chance(0.8)) {
    const output = freshType()
    const secondArm = secondSourceType === null ? null : press[secondSourceType] ?? secondSourceType
    // Two of the same item is the level-001 shape, and the only one that
    // creates the press-then-split versus split-then-press choice — which is
    // what criterion 4 is looking for.
    const pair: [ItemType, ItemType] =
      secondArm !== null && chance(0.45) ? [deepest, secondArm] : [deepest, deepest]
    assembler.push({ in: pair, out: output })
    target = output

    // rules-spec §3 rejects duplicate recipes at load, so a level carrying one
    // would fail to parse rather than fail to solve. A converging second chain
    // makes `secondArm` and `deepest` the same item, which is exactly when the
    // alternative below collides with the recipe just pushed.
    const alreadyHave = (a: ItemType, b: ItemType) =>
      assembler.some((r) => r.out === output && [...r.in].sort().join() === [a, b].sort().join())

    // A second way to reach the same target. Without one, a level whose pair
    // is two *different* types has exactly one plan and criterion 4 can only
    // ever reject it — which is what made `single_solution` the largest class.
    if (options.alternativeRoutes && chance(0.55)) {
      if (pair[0] !== pair[1] && !alreadyHave(deepest, deepest)) {
        // Two arms already. Add the level-001 shape, which needs a splitter and
        // is therefore a genuinely different machine multiset.
        assembler.push({ in: [deepest, deepest], out: output })
      } else if (secondArm !== null && !alreadyHave(deepest, secondArm)) {
        // It already has the split-or-press choice; offer the two-arm route too.
        assembler.push({ in: [deepest, secondArm], out: output })
      } else if (secondArm === null) {
        // One source and nothing to pair it with, so the alternative has to go
        // *upstream* of the target rather than around it: a second way to reach
        // the item the assembler consumes.
        //
        // Deliberately not a press straight to the target. That was tried and
        // it reads well until you look at the log — a fan-out-free route to the
        // target means the stage-B fan-out proof stops applying, and it took
        // `insufficient_fanout` from 24 rejections to 6. Keeping the target
        // behind an `x + x` pair keeps that proof meaningful, and the extra
        // idea still lands because the assembler here needs a splitter of its
        // own, making it a genuinely different machine multiset.
        assembler.push({ in: [base, base], out: deepest })
      }
    }
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
