/**
 * The daily rotation.
 *
 * Most of what can go wrong here is unreachable by waiting: the wrap at the end
 * of the pool, a daylight-saving boundary, a device clock set to the wrong
 * year. That is the whole reason `dayNumber` takes the instant as an argument
 * instead of reading a clock, and these are the tests that spend it.
 */

import { describe, expect, it } from 'vitest'
import { validateLevel } from '@factory/sim'

import { dayNumber, poolDays, pool, puzzleFor, today, LAUNCH } from './daily'

/** A local-time instant, which is what a player's device actually reports. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

describe('dayNumber', () => {
  it('starts at 1 on launch day', () => {
    expect(dayNumber(at(LAUNCH.year, LAUNCH.month, LAUNCH.day))).toBe(1)
  })

  it('advances by one per calendar day', () => {
    expect(dayNumber(at(2026, 8, 11))).toBe(2)
    expect(dayNumber(at(2026, 8, 20))).toBe(11)
    expect(dayNumber(at(2026, 9, 10))).toBe(32)
  })

  it('is the same all day, from first minute to last', () => {
    const first = dayNumber(at(2026, 9, 3, 0, 0))
    expect(dayNumber(at(2026, 9, 3, 11, 59))).toBe(first)
    expect(dayNumber(at(2026, 9, 3, 23, 59))).toBe(first)
    // ...and has ticked over by the next minute.
    expect(dayNumber(at(2026, 9, 4, 0, 0))).toBe(first + 1)
  })

  it('does not skip or repeat a day across daylight saving', () => {
    // Local midnights are 23 or 25 hours apart on the changeover, so a version
    // that subtracted raw timestamps and floored would drift by a day. Walk a
    // fortnight around both northern transitions and require strict +1 steps.
    for (const [year, month, from, to] of [[2027, 3, 8, 22], [2027, 10, 24, 38]] as const) {
      let previous = dayNumber(at(year, month, from))
      for (let d = from + 1; d <= to; d += 1) {
        const current = dayNumber(at(year, month, d))
        expect(current).toBe(previous + 1)
        previous = current
      }
    }
  })

  it('clamps a clock set before launch rather than going negative', () => {
    expect(dayNumber(at(2025, 1, 1))).toBe(1)
    expect(dayNumber(at(1999, 6, 6))).toBe(1)
  })
})

describe('puzzleFor', () => {
  it('gives every day in the pool a different puzzle', () => {
    const ids = new Set<string>()
    for (let day = 1; day <= poolDays; day += 1) ids.add(puzzleFor(day).id)
    expect(ids.size).toBe(poolDays)
  })

  it('repeats the pool once it runs out rather than running dry', () => {
    expect(puzzleFor(poolDays + 1).id).toBe(puzzleFor(1).id)
    expect(puzzleFor(poolDays * 3 + 7).id).toBe(puzzleFor(7).id)
  })

  it('always returns a puzzle, however odd the day', () => {
    for (const day of [1, 0, -5, 1.7, 99_999]) {
      expect(puzzleFor(day)).toBeDefined()
      expect(puzzleFor(day).id).toMatch(/^gen-/)
    }
  })

  it('is stable — the same day is the same puzzle every time it is asked', () => {
    for (const day of [1, 2, 57, poolDays, poolDays + 1]) {
      expect(puzzleFor(day).id).toBe(puzzleFor(day).id)
    }
  })
})

describe('the pool itself', () => {
  it('holds enough puzzles to be worth calling daily', () => {
    // Six months is the bar: shorter and a player laps the rotation before the
    // habit forms, which defeats the point of shipping one a day.
    expect(poolDays).toBeGreaterThan(180)
  })

  it('contains only levels the simulator will load', () => {
    // These are generated, so nothing hand-checked them. A malformed level
    // would surface as a blank board on whichever day it came up.
    for (const level of pool) expect(validateLevel(level)).toEqual([])
  })

  it('carries a computed par on every level', () => {
    // §2: par is the validator's, never the generator's. A zero here means a
    // level slipped in without being solved, and the day it appeared the score
    // would be nonsense.
    for (const level of pool) expect(level.par).toBeGreaterThan(0)
  })

  it('holds nothing thin enough to finish by accident', () => {
    // Curation, not validation — the validator accepts these, the rotation
    // does not deal them. See scratchpad/build-daily-pool.ts.
    for (const level of pool) expect(level.par).toBeGreaterThanOrEqual(14)
  })

  it('does not deal the same puzzle two days running', () => {
    for (let day = 1; day < poolDays; day += 1) {
      expect(puzzleFor(day).id).not.toBe(puzzleFor(day + 1).id)
    }
  })
})

describe('today', () => {
  it('reads the clock only when nobody supplies one', () => {
    const fixed = at(2026, 8, 14)
    expect(today(fixed)).toEqual({ day: 5, level: puzzleFor(5) })
  })

  it('works with no argument at all, whatever the real date is', () => {
    const now = today()
    expect(now.day).toBeGreaterThanOrEqual(1)
    expect(now.level.id).toMatch(/^gen-/)
  })
})
