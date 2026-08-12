/**
 * The share card.
 *
 * Two properties matter more than the formatting. It must not leak the
 * solution — a share that spoils the puzzle stops anyone sending it — and it
 * must not throw when the clipboard refuses, which it does routinely.
 */

import { describe, expect, it } from 'vitest'

import { PLAY_URL, copyShare, scoreLine, shareText, type Clipboard } from './share'
import type { Result } from './history'

const result = (over: number, ticks = 29): Result => ({
  day: 7,
  levelId: 'gen-643',
  par: 23,
  cost: 23 + over,
  ticks,
})

describe('scoreLine', () => {
  it('names par rather than showing a zero', () => {
    expect(scoreLine(result(0))).toBe('Par (23) · 29 ticks')
  })

  it('counts strokes over', () => {
    expect(scoreLine(result(3))).toBe('+3 (26) · 29 ticks')
  })

  it('says under par in words, because it is the good news', () => {
    // par is the cheapest the *search* found and was never proven optimal, so
    // this is reachable and worth celebrating rather than printing as "-2".
    expect(scoreLine(result(-2))).toBe('2 under par (21) · 29 ticks')
  })
})

describe('shareText', () => {
  it('leads with the day so two people know they played the same puzzle', () => {
    expect(shareText(result(0), 1).split('\n')[0]).toBe('⬢ Factory Puzzle #7')
  })

  it('includes a streak worth mentioning', () => {
    expect(shareText(result(0), 4)).toContain('4 day streak')
  })

  it('leaves out a streak of one, which is not an achievement', () => {
    expect(shareText(result(0), 1)).not.toContain('streak')
    expect(shareText(result(0), 0)).not.toContain('streak')
  })

  it('ends with somewhere to play', () => {
    expect(shareText(result(2), 3).trim().endsWith(PLAY_URL)).toBe(true)
  })

  it('never leaks how the puzzle was solved', () => {
    // The point of a share is that it is safe to read. Cost and ticks are
    // comparable; anything naming a building or a cell would be a spoiler.
    const text = shareText(result(2), 5).toLowerCase()
    for (const spoiler of ['press', 'splitter', 'assembler', 'merger', 'conveyor', 'belt', 'gen-']) {
      expect(text).not.toContain(spoiler)
    }
    expect(text).not.toMatch(/\d+\s*,\s*\d+/) // no cell coordinates
  })

  it('stays small enough to paste anywhere', () => {
    expect(shareText(result(12), 99).length).toBeLessThan(200)
  })
})

describe('copyShare', () => {
  it('reports success when the clipboard takes it', async () => {
    const written: string[] = []
    const clipboard: Clipboard = { write: async (t) => { written.push(t) } }
    expect(await copyShare('hello', clipboard)).toBe(true)
    expect(written).toEqual(['hello'])
  })

  it('reports failure instead of throwing when the clipboard refuses', async () => {
    // Embedded webviews, denied permissions and insecure contexts all reject.
    // The caller falls back to showing the text; it must not lose the win.
    const hostile: Clipboard = { write: async () => { throw new Error('denied') } }
    expect(await copyShare('hello', hostile)).toBe(false)
  })

  it('reports failure when there is no clipboard at all', async () => {
    expect(await copyShare('hello', null)).toBe(false)
  })
})
