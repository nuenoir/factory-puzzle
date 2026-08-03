/** Shared visual constants. Kept boring on purpose — plain colours and sizes. */

import type { BuildingType, ItemType } from '@factory/sim'

/** Cell size is computed from the viewport; these bound it. Android is a
 *  target (CLAUDE.md), and a fixed cell width puts a 7-wide board off the edge
 *  of a phone screen with no way to scroll to it. */
export const MAX_CELL = 62
export const MIN_CELL = 34
export const GAP = 2

/**
 * A pointy-top hexagon is taller than it is wide by 2/√3, and rows overlap:
 * each row sits three quarters of a hex height below the last, with odd rows
 * pushed half a hex to the right (§2, odd-r offset).
 */
export const HEX_RATIO = 2 / Math.sqrt(3)
export const hexHeight = (w: number): number => w * HEX_RATIO
export const rowStep = (w: number): number => hexHeight(w) * 0.75

/** The largest hex width that fits `columns` of board inside `available` px. */
export function cellSizeFor(available: number, columns: number): number {
  // Odd rows overhang by half a hex, so the board spans (columns + 0.5) hexes.
  const size = Math.floor((available - GAP * 2) / (columns + 0.5))
  return Math.max(MIN_CELL, Math.min(MAX_CELL, size))
}

/** Board pixel size for a `columns × rows` hex grid of hex width `w`. */
export function boardSize(w: number, columns: number, rows: number) {
  return {
    width: w * (columns + 0.5),
    height: hexHeight(w) * 0.25 + rowStep(w) * rows,
  }
}

/** Top-left of a cell's bounding box, in board pixels. */
export function cellOrigin(x: number, y: number, w: number) {
  return { left: x * w + (y % 2 === 1 ? w / 2 : 0), top: y * rowStep(w) }
}

/** Centre of a cell, in board pixels. */
export function cellCentre(x: number, y: number, w: number) {
  const { left, top } = cellOrigin(x, y, w)
  return { cx: left + w / 2, cy: top + hexHeight(w) / 2 }
}

/**
 * Which cell contains a board pixel.
 *
 * Cell bounding boxes overlap — rows sit only three quarters apart and odd
 * rows are offset — so a point inside one box is often inside another hexagon.
 * Nearest centre is the exact answer, not an approximation: a hexagonal grid
 * is precisely the Voronoi diagram of its centres. Only the nine cells around
 * the estimate can win, so this stays cheap.
 */
export function hexAt(px: number, py: number, w: number, columns: number, rows: number) {
  const estimateRow = Math.round((py - hexHeight(w) / 2) / rowStep(w))
  let best: { x: number; y: number } | null = null
  let bestDistance = Infinity

  for (let y = estimateRow - 1; y <= estimateRow + 1; y += 1) {
    if (y < 0 || y >= rows) continue
    const offset = y % 2 === 1 ? w / 2 : 0
    const estimateCol = Math.round((px - offset - w / 2) / w)
    for (let x = estimateCol - 1; x <= estimateCol + 1; x += 1) {
      if (x < 0 || x >= columns) continue
      const { cx, cy } = cellCentre(x, y, w)
      const distance = (px - cx) ** 2 + (py - cy) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = { x, y }
      }
    }
  }
  return best
}

export const colors = {
  screen: '#12141a',
  panel: '#1b1e27',
  panelEdge: '#272b38',
  text: '#f4f6fb',
  muted: '#8b93a7',
  faint: '#5d6478',
  board: '#0d0f14',
  emptyCell: '#171a22',
  cellEdge: '#232735',
  good: '#4ade80',
  bad: '#f87171',
  warn: '#fbbf24',
}

interface BuildingStyle {
  readonly fill: string
  readonly accent: string
  readonly label: string
}

/** One entry per building type. Sources and sinks are level fixtures. */
export const buildingStyles: Readonly<Record<BuildingType, BuildingStyle>> = {
  source: { fill: '#16301f', accent: '#4ade80', label: 'SRC' },
  sink: { fill: '#152738', accent: '#60a5fa', label: 'SINK' },
  conveyor: { fill: '#1e2230', accent: '#7c8598', label: '' },
  press: { fill: '#33260f', accent: '#fbbf24', label: 'PRESS' },
  assembler: { fill: '#2b1c39', accent: '#c084fc', label: 'ASSEM' },
  splitter: { fill: '#13303a', accent: '#22d3ee', label: 'SPLIT' },
  merger: { fill: '#13303a', accent: '#22d3ee', label: 'MERGE' },
}

/**
 * Lighten or darken a `#rrggbb` colour. `amount` runs -1 (black) to 1 (white).
 *
 * Everything on the board is lit from above: a face gets a lighter top and a
 * darker underside, which is most of what stops a flat fill reading as a
 * sticker. Cheaper and more controllable than shipping a gradient library.
 */
export function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  const mixed = channels.map((c) => {
    const target = amount >= 0 ? 255 : 0
    return Math.round(c + (target - c) * Math.abs(amount))
  })
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const itemPalette = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#c084fc', '#f472b6', '#fb923c']

/**
 * A stable colour per item type. The engine treats item types as opaque
 * strings (§3), so the UI cannot hard-code them — hash instead.
 */
export function itemColor(type: ItemType): string {
  let hash = 0
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) | 0
  return itemPalette[Math.abs(hash) % itemPalette.length]
}

/** Arrow glyphs, used to show which way a conveyor or output port points. */
export const arrow = { E: '→', SE: '↘', SW: '↙', W: '←', NW: '↖', NE: '↗' } as const
