/**
 * Streaks, history and the storage round-trip.
 *
 * A streak bug only shows up on the day it costs somebody a long run, which is
 * the worst possible time to find it. Everything here takes `today` as an
 * argument so the interesting cases — the gap, the replay, the run that is
 * alive but not yet extended — are reachable now rather than in a fortnight.
 */

import { describe, expect, it } from 'vitest'

import {
  STORAGE_KEY,
  bestStreak,
  currentStreak,
  emptyHistory,
  loadHistory,
  parseHistory,
  record,
  resultFor,
  saveHistory,
  serialiseHistory,
  solved,
  stats,
  type History,
  type Store,
} from './history'

const result = (day: number, cost = 25, par = 23) => ({
  day,
  levelId: `gen-${day}`,
  par,
  cost,
  ticks: 30,
})

/** A history with these days solved. */
const withDays = (...days: number[]): History =>
  days.reduce((h, day) => record(h, result(day)), emptyHistory)

/** An in-memory stand-in for localStorage. */
function fakeStore(initial: Record<string, string> = {}): Store & { data: Record<string, string> } {
  const data = { ...initial }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}

describe('recording a solve', () => {
  it('remembers what was solved and at what cost', () => {
    const history = record(emptyHistory, result(3, 24, 23))
    expect(solved(history, 3)).toBe(true)
    expect(resultFor(history, 3)?.cost).toBe(24)
    expect(solved(history, 2)).toBe(false)
  })

  it('keeps the better score when a day is replayed', () => {
    let history = record(emptyHistory, result(3, 28))
    history = record(history, result(3, 24))
    expect(resultFor(history, 3)?.cost).toBe(24)
  })

  it('does not let a worse replay overwrite a good score', () => {
    let history = record(emptyHistory, result(3, 24))
    history = record(history, result(3, 31))
    expect(resultFor(history, 3)?.cost).toBe(24)
  })

  it('never mutates the history it was given', () => {
    const before = withDays(1, 2)
    const snapshot = serialiseHistory(before)
    record(before, result(3))
    expect(serialiseHistory(before)).toBe(snapshot)
  })

  it('stores the level id and par, so a rebuilt pool cannot rescore the past', () => {
    // The pool is generated. Regenerate it with a different seed or curation
    // rule and day 3 is a different puzzle — a result that looked its par up
    // later would be scored against a level the player never saw.
    const history = record(emptyHistory, result(3, 24, 23))
    expect(resultFor(history, 3)).toMatchObject({ levelId: 'gen-3', par: 23 })
  })
})

describe('currentStreak', () => {
  it('is zero on an empty history', () => {
    expect(currentStreak(emptyHistory, 10)).toBe(0)
  })

  it('counts an unbroken run ending today', () => {
    expect(currentStreak(withDays(5, 6, 7), 7)).toBe(3)
  })

  it('survives today not being played yet', () => {
    // There are still hours left to play it. Breaking the streak at midnight
    // for a day that is not over would be wrong and would feel worse.
    expect(currentStreak(withDays(5, 6, 7), 8)).toBe(3)
  })

  it('breaks once a whole day has been missed', () => {
    expect(currentStreak(withDays(5, 6, 7), 9)).toBe(0)
  })

  it('counts only the run touching today, not the longest one', () => {
    expect(currentStreak(withDays(1, 2, 3, 4, 9), 9)).toBe(1)
  })

  it('handles a run that reaches back to day one', () => {
    expect(currentStreak(withDays(1, 2, 3), 3)).toBe(3)
  })

  it('ignores days recorded ahead of today', () => {
    // A device clock jumped forward, a result got stored, the clock came back.
    expect(currentStreak(withDays(4, 5, 99), 5)).toBe(2)
  })
})

describe('bestStreak', () => {
  it('is zero on an empty history', () => {
    expect(bestStreak(emptyHistory)).toBe(0)
  })

  it('finds the longest run anywhere in the record', () => {
    expect(bestStreak(withDays(1, 2, 9, 10, 11, 12, 20))).toBe(4)
  })

  it('does not care what order the days were recorded in', () => {
    expect(bestStreak(withDays(11, 9, 12, 10))).toBe(4)
  })

  it('counts a lone day as a run of one', () => {
    expect(bestStreak(withDays(7))).toBe(1)
  })
})

describe('stats', () => {
  it('summarises an empty history without inventing anything', () => {
    expect(stats(emptyHistory, 1)).toEqual({
      solved: 0, currentStreak: 0, bestStreak: 0, bestToPar: null, toPar: {},
    })
  })

  it('counts scores against par, including beating it', () => {
    // par is the cheapest solution the *search* found, never proven optimal,
    // so a player coming in under it is a real outcome and worth showing.
    let history = record(emptyHistory, result(1, 23, 23))
    history = record(history, result(2, 26, 23))
    history = record(history, result(3, 21, 23))
    const s = stats(history, 3)
    expect(s.solved).toBe(3)
    expect(s.bestToPar).toBe(-2)
    expect(s.toPar).toEqual({ '0': 1, '3': 1, '-2': 1 })
  })
})

describe('parseHistory', () => {
  it('round-trips a real history', () => {
    const history = withDays(1, 2, 5)
    expect(parseHistory(serialiseHistory(history))).toEqual(history)
  })

  it('returns empty for nothing stored', () => {
    expect(parseHistory(null)).toEqual(emptyHistory)
  })

  it('survives whatever is actually in storage', () => {
    // This runs before the first paint. A truncated write or a hand-edited
    // string should cost the streak, not the board.
    for (const raw of ['', 'null', '{', '[]', '"nope"', '{"version":2,"results":{}}', '{"version":1}']) {
      expect(parseHistory(raw)).toEqual(emptyHistory)
    }
  })

  it('drops malformed entries but keeps the sound ones', () => {
    const raw = JSON.stringify({
      version: 1,
      results: {
        '1': result(1),
        '2': { day: 2, levelId: 'gen-2', par: 'twenty', cost: 24, ticks: 30 },
        '3': { day: 3, cost: 24, ticks: 30, par: 23 },
        '4': null,
        '5': { day: 5, levelId: 'gen-5', par: 23, cost: Infinity, ticks: 30 },
        '6': result(6),
      },
    })
    const history = parseHistory(raw)
    expect(Object.keys(history.results).sort()).toEqual(['1', '6'])
  })

  it('drops an entry whose key disagrees with its own day', () => {
    // Every lookup goes through the key, so such a record is unreachable at
    // best and mis-attributed at worst.
    const raw = JSON.stringify({ version: 1, results: { '4': result(9) } })
    expect(parseHistory(raw).results).toEqual({})
  })
})

describe('storage', () => {
  it('round-trips through a store', () => {
    const store = fakeStore()
    const history = withDays(3, 4)
    expect(saveHistory(history, store)).toBe(true)
    expect(loadHistory(store)).toEqual(history)
    expect(Object.keys(store.data)).toEqual([STORAGE_KEY])
  })

  it('reports no history when there is no storage at all', () => {
    expect(loadHistory(null)).toEqual(emptyHistory)
    expect(saveHistory(withDays(1), null)).toBe(false)
  })

  it('does not throw when the store does', () => {
    // Private browsing, a full quota, a blocked origin. Losing a streak is a
    // disappointment; throwing out of the win handler would lose the win too.
    const hostile: Store = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('quota') },
    }
    expect(loadHistory(hostile)).toEqual(emptyHistory)
    expect(saveHistory(withDays(1), hostile)).toBe(false)
  })
})
