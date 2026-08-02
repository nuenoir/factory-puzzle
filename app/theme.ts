/** Shared visual constants. Kept boring on purpose — plain colours and sizes. */

import type { BuildingType, ItemType } from '@factory/sim'

/** Cell size is computed from the viewport; these bound it. Android is a
 *  target (CLAUDE.md), and a fixed 58px cell puts a 7-wide board off the edge
 *  of a phone screen with no way to scroll to it. */
export const MAX_CELL = 58
export const MIN_CELL = 32
export const GAP = 3
/** Thickness of the bars drawn on a cell edge to mark a port. */
export const PORT = 4

/** The largest cell that fits `columns` of board inside `available` pixels. */
export function cellSizeFor(available: number, columns: number): number {
  const usable = available - GAP * 4
  const size = Math.floor(usable / columns) - GAP
  return Math.max(MIN_CELL, Math.min(MAX_CELL, size))
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
export const arrow = { N: '↑', E: '→', S: '↓', W: '←' } as const
