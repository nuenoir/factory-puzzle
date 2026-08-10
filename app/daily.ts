/**
 * Which puzzle today is.
 *
 * Pure by rule (CLAUDE.md): the instant comes in as an argument and no clock is
 * read in here. That is what lets the rotation be tested on the day it wraps,
 * on a daylight-saving boundary, and on a date years out, none of which are
 * reachable by waiting.
 */

import type { Level } from '@factory/sim'

import poolJson from '../levels/daily.json'

/** Generated, not written. Rebuild with scratchpad/build-daily-pool.ts. */
export const pool = poolJson as unknown as Level[]

/** Day 1 of the rotation. */
export const LAUNCH = { year: 2026, month: 8, day: 10 } as const

const MS_PER_DAY = 86_400_000

/**
 * Midnight of the *local* calendar date, expressed as a UTC instant.
 *
 * Local rather than UTC, deliberately. The alternative rolls the puzzle over at
 * 00:00 UTC, which is mid-morning in Sydney and mid-evening in New York, and a
 * daily puzzle that changes over lunch is a worse daily puzzle. Taking the
 * local Y/M/D means everyone gets today's puzzle on their own today.
 *
 * "Same puzzle for everyone" still holds where it matters, because the *day
 * number* is what a shared score names — two people comparing day 42 compare
 * the same puzzle, whichever side of the dateline they are on. The only cost is
 * that during the hours when the calendar disagrees, one of them is a day ahead.
 *
 * Reading the fields and rebuilding through `Date.UTC` also sidesteps daylight
 * saving: local midnights are 23 or 25 hours apart twice a year, and
 * subtracting raw timestamps would eventually drop or repeat a day.
 */
function localMidnightUTC(at: Date): number {
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())
}

const LAUNCH_UTC = Date.UTC(LAUNCH.year, LAUNCH.month - 1, LAUNCH.day)

/**
 * The 1-based day number for an instant, clamped at 1.
 *
 * Clamped because a device clock set to last year should still get a playable
 * puzzle rather than a negative index — being wrong about the date is the
 * player's problem, crashing is mine.
 */
export function dayNumber(at: Date): number {
  const days = Math.round((localMidnightUTC(at) - LAUNCH_UTC) / MS_PER_DAY)
  return Math.max(1, days + 1)
}

/** The puzzle for a day number. The pool repeats once it runs out. */
export function puzzleFor(day: number): Level {
  const index = (Math.max(1, Math.trunc(day)) - 1) % pool.length
  return pool[index]
}

/** How many days until the rotation starts repeating. */
export const poolDays = pool.length

/** Convenience for the app, which is the only place allowed to read a clock. */
export function today(now: Date = new Date()): { day: number; level: Level } {
  const day = dayNumber(now)
  return { day, level: puzzleFor(day) }
}
