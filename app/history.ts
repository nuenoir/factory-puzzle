/**
 * What the player has solved, and how long a run they are on.
 *
 * Pure over a plain record, with the clock and the storage both passed in.
 * A streak is only interesting once it is long, which makes it the one thing
 * here nobody can test by playing — so none of it may depend on today actually
 * being today.
 */

import type { Level } from '@factory/sim'

/**
 * One solved day.
 *
 * `levelId` and `par` are stored rather than looked up. `puzzleFor(day)` is
 * stable only while the pool is, and the pool is generated — rebuilding it with
 * a different seed, count or curation rule renumbers everything. Without these
 * fields an old result would silently be scored against a puzzle the player
 * never saw.
 */
export interface Result {
  readonly day: number
  readonly levelId: string
  readonly par: number
  /** What they solved it at. Golf: lower is better, and par is beatable. */
  readonly cost: number
  readonly ticks: number
  /**
   * The tick each delivery landed on, for the share card's run trace.
   *
   * Optional, and additive on purpose: records written before this existed stay
   * readable and simply have no trace, which is a better outcome than bumping
   * the schema version and throwing away everyone's streak.
   */
  readonly deliveredAt?: readonly number[]
}

export interface History {
  readonly version: 1
  /** Keyed by day number as a string, because JSON has no integer keys. */
  readonly results: Readonly<Record<string, Result>>
}

export const STORAGE_KEY = 'factory-puzzle:history:v1'

export const emptyHistory: History = { version: 1, results: {} }

export function resultFor(history: History, day: number): Result | undefined {
  return history.results[String(day)]
}

export function solved(history: History, day: number): boolean {
  return resultFor(history, day) !== undefined
}

/**
 * Add a result, keeping the cheapest if the day is replayed.
 *
 * Replaying is possible — nothing stops a reload — and a player who comes back
 * and does better should keep the better score. There is no leaderboard for
 * that to be unfair to.
 */
export function record(history: History, result: Result): History {
  const existing = resultFor(history, result.day)
  if (existing !== undefined && existing.cost <= result.cost) return history
  return {
    version: 1,
    results: { ...history.results, [String(result.day)]: result },
  }
}

/**
 * Days solved in an unbroken run up to `today`.
 *
 * Today not being played yet does **not** break the run — there are still hours
 * left in which to play it — so the count is taken from today if today is
 * solved, and from yesterday otherwise. Two consecutive unsolved days is a
 * broken streak.
 */
export function currentStreak(history: History, today: number): number {
  let day = solved(history, today) ? today : today - 1
  let run = 0
  while (day >= 1 && solved(history, day)) {
    run += 1
    day -= 1
  }
  return run
}

/** The longest unbroken run ever, whether or not it is the current one. */
export function bestStreak(history: History): number {
  const days = Object.values(history.results).map((r) => r.day).sort((a, b) => a - b)
  let best = 0
  let run = 0
  let previous: number | null = null
  for (const day of days) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1
    if (run > best) best = run
    previous = day
  }
  return best
}

export interface Stats {
  readonly solved: number
  readonly currentStreak: number
  readonly bestStreak: number
  /** Best result ever, as strokes against par. Negative means under par. */
  readonly bestToPar: number | null
  /**
   * How often each score-to-par came up, keyed by the difference. Sparse, and
   * it can hold negative keys: `par` is the cheapest solution the *search*
   * found and was never proven optimal, so a player really can come in under it.
   */
  readonly toPar: Readonly<Record<string, number>>
}

export function stats(history: History, today: number): Stats {
  const results = Object.values(history.results)
  const toPar: Record<string, number> = {}
  let bestToPar: number | null = null

  for (const result of results) {
    const delta = result.cost - result.par
    toPar[String(delta)] = (toPar[String(delta)] ?? 0) + 1
    if (bestToPar === null || delta < bestToPar) bestToPar = delta
  }

  return {
    solved: results.length,
    currentStreak: currentStreak(history, today),
    bestStreak: bestStreak(history),
    bestToPar,
    toPar,
  }
}

/* ---- persistence ------------------------------------------------------- */

/** The slice of `localStorage` this needs, so tests can hand over a fake. */
export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Parse stored JSON into a history, falling back to empty on anything odd.
 *
 * Deliberately total. This runs before the first paint, and a player whose
 * storage holds a truncated write, a hand-edited string or a record from a
 * future version should get a working board and a lost streak — not a blank
 * screen. Every field is checked because none of it is ours once it has been
 * round-tripped through a browser the player controls.
 */
export function parseHistory(raw: string | null): History {
  if (raw === null) return emptyHistory
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyHistory
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyHistory

  const { version, results } = parsed as { version?: unknown; results?: unknown }
  if (version !== 1) return emptyHistory
  if (typeof results !== 'object' || results === null) return emptyHistory

  const clean: Record<string, Result> = {}
  for (const [key, value] of Object.entries(results as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const r = value as Partial<Result>
    const numbers = [r.day, r.par, r.cost, r.ticks]
    if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) continue
    if (typeof r.levelId !== 'string') continue
    if ((r.day as number) < 1) continue
    // The key is what every lookup goes through, so a record that disagrees
    // with its own key is unusable however well-formed it otherwise looks.
    if (key !== String(r.day)) continue
    // Absent on records written before the trace existed; dropped wholesale if
    // it is not a clean list of numbers, since a partial trace would draw a lie.
    const deliveredAt =
      Array.isArray(r.deliveredAt) && r.deliveredAt.every((n) => typeof n === 'number' && Number.isFinite(n))
        ? (r.deliveredAt as number[])
        : undefined
    clean[key] = {
      day: r.day as number,
      levelId: r.levelId,
      par: r.par as number,
      cost: r.cost as number,
      ticks: r.ticks as number,
      ...(deliveredAt === undefined ? {} : { deliveredAt }),
    }
  }
  return { version: 1, results: clean }
}

export function serialiseHistory(history: History): string {
  return JSON.stringify(history)
}

/** Read the history, or an empty one if storage is missing or unreadable. */
export function loadHistory(store: Store | null = defaultStore()): History {
  if (store === null) return emptyHistory
  try {
    return parseHistory(store.getItem(STORAGE_KEY))
  } catch {
    return emptyHistory
  }
}

/**
 * Write the history, swallowing failure.
 *
 * Storage throws for reasons that have nothing to do with this game — private
 * browsing, a full quota, a blocked origin. Losing a streak is a disappointment;
 * throwing out of a win handler would lose the win as well.
 */
export function saveHistory(history: History, store: Store | null = defaultStore()): boolean {
  if (store === null) return false
  try {
    store.setItem(STORAGE_KEY, serialiseHistory(history))
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
