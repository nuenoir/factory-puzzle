/**
 * The board's geometry and lighting helpers.
 *
 * `hexAt` is the one that matters: every tap, drag and belt the player draws
 * goes through it. Hexagon bounding boxes overlap, so a point inside one box
 * is often inside a different hexagon — nearest centre is the exact answer,
 * and these check it at the awkward places rather than only in the middle.
 */

import { describe, expect, it } from 'vitest'

import { cellCentre, cellSizeFor, hexAt, shade } from './theme'

const W = 60
const COLS = 7
const ROWS = 7

describe('hexAt', () => {
  it('maps the centre of every cell back to that cell', () => {
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const { cx, cy } = cellCentre(x, y, W)
        expect(hexAt(cx, cy, W, COLS, ROWS)).toEqual({ x, y })
      }
    }
  })

  it('accounts for the half-cell shift on odd rows', () => {
    // Same pixel column, one row apart: odd rows sit half a hex to the right,
    // so the cell directly below (2,2) is not (2,3).
    const { cx } = cellCentre(2, 2, W)
    const even = hexAt(cx, cellCentre(2, 2, W).cy, W, COLS, ROWS)
    const odd = hexAt(cx, cellCentre(2, 3, W).cy, W, COLS, ROWS)
    expect(even).toEqual({ x: 2, y: 2 })
    expect(odd).not.toEqual({ x: 2, y: 3 })
  })

  it('picks the neighbour once a point crosses the halfway line', () => {
    const here = cellCentre(3, 3, W)
    const east = cellCentre(4, 3, W)
    const justPastMiddle = here.cx + (east.cx - here.cx) * 0.6
    expect(hexAt(justPastMiddle, here.cy, W, COLS, ROWS)).toEqual({ x: 4, y: 3 })
    const justBefore = here.cx + (east.cx - here.cx) * 0.4
    expect(hexAt(justBefore, here.cy, W, COLS, ROWS)).toEqual({ x: 3, y: 3 })
  })

  it('never returns a cell outside the grid', () => {
    for (const [px, py] of [[-500, -500], [9999, 9999], [-10, 300], [300, -10]]) {
      const cell = hexAt(px, py, W, COLS, ROWS)
      if (cell === null) continue
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.x).toBeLessThan(COLS)
      expect(cell.y).toBeGreaterThanOrEqual(0)
      expect(cell.y).toBeLessThan(ROWS)
    }
  })
})

describe('cellSizeFor', () => {
  it('shrinks the board to fit a narrow screen', () => {
    expect(cellSizeFor(360, 7)).toBeLessThan(cellSizeFor(900, 7))
  })

  it('never returns a size that would push the board off screen', () => {
    for (const available of [280, 320, 375, 480, 768, 1200]) {
      const w = cellSizeFor(available, 7)
      // Odd rows overhang by half a hex, so the board spans columns + 0.5.
      expect(w * 7.5).toBeLessThanOrEqual(available)
    }
  })
})

describe('shade', () => {
  it('leaves a colour alone at zero', () => {
    expect(shade('#4ade80', 0)).toBe('#4ade80')
  })

  it('goes to white and black at the extremes', () => {
    expect(shade('#4ade80', 1)).toBe('#ffffff')
    expect(shade('#4ade80', -1)).toBe('#000000')
  })

  it('always returns a well-formed hex colour', () => {
    for (const amount of [-1, -0.62, -0.22, 0, 0.16, 0.5, 1]) {
      for (const colour of ['#f87171', '#60a5fa', '#000000', '#ffffff']) {
        expect(shade(colour, amount)).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('accepts the three-digit shorthand', () => {
    expect(shade('#fff', -1)).toBe('#000000')
  })
})
