/**
 * The board. Pointy-top hexagons in odd-r offset coordinates (§2), built from
 * plain React Native Views — no canvas, no SVG dependency (CLAUDE.md).
 *
 * A hexagon is three Views: a triangle, a rectangle, and another triangle. The
 * triangles are the standard React Native border trick (zero-size box, fat
 * transparent side borders), which renders identically on web and Android.
 *
 * The only input is a `Snapshot` from the simulator. Nothing is recomputed and
 * nothing is guessed: every dot on screen is a real item sitting in a real
 * cell or buffer, so what you see is exactly what the engine scored.
 */

import { useMemo, useRef } from 'react'
import { PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import type { BuildingSnapshot, Direction, ItemType, Snapshot } from '@factory/sim'

import { deriveTransits, jobProgress, type Anchor, type Transit } from '../motion'

import {
  GAP,
  arrow,
  boardSize,
  buildingStyles,
  cellOrigin,
  cellSizeFor,
  colors,
  hexAt,
  hexHeight,
  itemColor,
} from '../theme'

export type PointerPhase = 'down' | 'move' | 'up'

interface GridProps {
  readonly snapshot: Snapshot
  readonly width: number
  readonly height: number
  /** Called with the cell under the pointer. `up` carries the last cell again. */
  readonly onCell?: (phase: PointerPhase, x: number, y: number) => void
  /** The tick before this one, so items can slide instead of teleporting. */
  readonly previous?: Snapshot | null
  /** How far through the tick the animation is, 0 to 1. */
  readonly progress?: number
  /** Machine duration, for the job rings. */
  readonly duration?: number
}

export function Grid({ snapshot, width, height, onCell, previous = null, progress = 1, duration = 2 }: GridProps) {
  const { width: windowWidth } = useWindowDimensions()
  const w = cellSizeFor(Math.min(windowWidth - 24, 520), width)
  const board = boardSize(w, width, height)

  // PanResponder is recreated when geometry changes; the callback is read
  // through a ref so a new handler identity does not rebuild the responder
  // mid-drag and drop the gesture.
  const onCellRef = useRef(onCell)
  onCellRef.current = onCell
  const lastCell = useRef<{ x: number; y: number } | null>(null)

  const responder = useMemo(() => {
    const locate = (event: GestureResponderEvent) => {
      const { locationX, locationY } = event.nativeEvent
      return hexAt(locationX - GAP, locationY - GAP, w, width, height)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const cell = locate(event)
        if (!cell) return
        lastCell.current = cell
        onCellRef.current?.('down', cell.x, cell.y)
      },
      onPanResponderMove: (event) => {
        const cell = locate(event)
        if (!cell) return
        const previous = lastCell.current
        if (previous && previous.x === cell.x && previous.y === cell.y) return
        lastCell.current = cell
        onCellRef.current?.('move', cell.x, cell.y)
      },
      onPanResponderRelease: () => {
        const cell = lastCell.current
        onCellRef.current?.('up', cell?.x ?? -1, cell?.y ?? -1)
      },
      onPanResponderTerminate: () => {
        const cell = lastCell.current
        onCellRef.current?.('up', cell?.x ?? -1, cell?.y ?? -1)
      },
    })
  }, [w, width, height])

  const byCell = new Map<string, BuildingSnapshot>()
  for (const b of snapshot.buildings) byCell.set(`${b.x},${b.y}`, b)

  const cells = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(
        <Cell key={`${x},${y}`} x={x} y={y} w={w} building={byCell.get(`${x},${y}`)} duration={duration} />,
      )
    }
  }

  // Items live in their own layer above the board so they can travel between
  // cells instead of being clipped inside one.
  const transits = deriveTransits(previous, snapshot)

  return (
    <View
      testID="board"
      style={[styles.board, { width: board.width + GAP * 2, height: board.height + GAP * 2 }]}
      {...(onCell ? responder.panHandlers : {})}
    >
      {cells}
      {transits.map((transit) => (
        <TravellingItem key={transit.key} transit={transit} w={w} progress={progress} />
      ))}
    </View>
  )
}

/** Eases out, so an item settles into a cell rather than stopping dead. */
function ease(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Pixel position of an anchor: the middle of a cell, or just inside a port. */
function anchorPoint(anchor: Anchor, w: number): { x: number; y: number } {
  const h = hexHeight(w)
  const { left, top } = cellOrigin(anchor.x, anchor.y, w)
  if (anchor.dir === undefined) return { x: left + w / 2, y: top + h / 2 }
  const edge = edgeCentre(anchor.dir, w, h)
  return { x: left + edge.x + (w / 2 - edge.x) * 0.5, y: top + edge.y + (h / 2 - edge.y) * 0.5 }
}

function TravellingItem({ transit, w, progress }: { transit: Transit; w: number; progress: number }) {
  const size = Math.round(w * (transit.from === null || transit.to === null ? 0.3 : 0.36))
  const t = ease(Math.min(1, Math.max(0, progress)))

  // A brand-new item grows into place; a consumed one shrinks away. Anything
  // that merely moved slides between the two anchors.
  const anchor = transit.to ?? transit.from
  if (anchor === undefined || anchor === null) return null
  const start = transit.from === null ? anchor : transit.from
  const end = transit.to === null ? anchor : transit.to

  const a = anchorPoint(start, w)
  const b = anchorPoint(end, w)
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t

  const scale = transit.from === null ? t : transit.to === null ? 1 - t : 1
  const drawn = Math.max(2, Math.round(size * scale))

  return (
    <View
      style={{
        position: 'absolute',
        left: GAP + x - drawn / 2,
        top: GAP + y - drawn / 2,
        opacity: transit.to === null ? 1 - t : 1,
      }}
    >
      <Item type={transit.type} size={drawn} />
    </View>
  )
}

interface CellProps {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly building: BuildingSnapshot | undefined
  readonly duration: number
}

function Cell({ x, y, w, building, duration }: CellProps) {
  const h = hexHeight(w)
  const { left, top } = cellOrigin(x, y, w)
  const style = building ? buildingStyles[building.type] : null
  const fill = style ? style.fill : colors.emptyCell
  const edge = style ? style.accent : colors.cellEdge

  const portSize = Math.max(5, Math.round(w * 0.15))
  const itemSize = Math.round(w * 0.36)
  const bufferSize = Math.round(w * 0.26)

  return (
    <View testID={`cell-${x}-${y}`} style={[styles.cell, { left: left + GAP, top: top + GAP, width: w, height: h }]}>
      {/* Outline hexagon behind a slightly smaller fill hexagon. */}
      <Hexagon w={w} h={h} fill={edge + (building ? '77' : '')} />
      <View style={[styles.inset, { left: 1.5, top: 1.5 }]}>
        <Hexagon w={w - 3} h={h - 3} fill={fill} />
      </View>

      {building ? (
        <>
          {/* Input ports dim, output ports bright — §4 port geometry. */}
          {building.inPorts.map((d) => (
            <Dot key={`in-${d}`} d={d} w={w} h={h} size={portSize} color={edge + '88'} />
          ))}
          {building.outPorts.map((d) => (
            <Dot key={`out-${d}`} d={d} w={w} h={h} size={portSize} color={edge} />
          ))}

          <View style={styles.centre}>
            {building.type === 'conveyor' ? (
              <Text style={{ color: edge, opacity: 0.55, fontSize: Math.round(w * 0.3), fontWeight: '700' }}>
                {arrow[building.outPorts[0] as Direction]}
              </Text>
            ) : (
              <Text style={{ color: edge, fontSize: Math.max(6, Math.round(w * 0.15)), fontWeight: '700' }}>
                {(style as { label: string }).label}
              </Text>
            )}
          </View>

          {/* Items are drawn in a layer above the board so they can travel
              between cells; only the job indicator lives in the cell. */}
          {progressOf(building, duration) !== null ? (
            <JobRing progress={progressOf(building, duration) as number} w={w} h={h} accent={edge} />
          ) : null}
        </>
      ) : null}
    </View>
  )
}

/** A pointy-top hexagon: triangle, rectangle, triangle. */
function Hexagon({ w, h, fill }: { w: number; h: number; fill: string }) {
  return (
    <View style={{ width: w, height: h }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderBottomWidth: h / 4,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: fill,
        }}
      />
      <View style={{ width: w, height: h / 2, backgroundColor: fill }} />
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderTopWidth: h / 4,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: fill,
        }}
      />
    </View>
  )
}

/**
 * Midpoint of the hexagon edge facing `d`. Pointy-top: E and W are the flat
 * vertical sides; the other four are the slanted edges.
 */
function edgeCentre(d: Direction, w: number, h: number): { x: number; y: number } {
  if (d === 'E') return { x: w, y: h / 2 }
  if (d === 'W') return { x: 0, y: h / 2 }
  if (d === 'NE') return { x: w * 0.75, y: h * 0.125 }
  if (d === 'NW') return { x: w * 0.25, y: h * 0.125 }
  if (d === 'SE') return { x: w * 0.75, y: h * 0.875 }
  return { x: w * 0.25, y: h * 0.875 }
}

function Dot({ d, w, h, size, color }: { d: Direction; w: number; h: number; size: number; color: string }) {
  const c = edgeCentre(d, w, h)
  return (
    <View
      style={{
        position: 'absolute',
        left: c.x - size / 2,
        top: c.y - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  )
}

const progressOf = jobProgress

/**
 * A bar across the bottom of a machine showing how far its job has run.
 *
 * A finished job whose output is blocked rests at full and turns amber: §8
 * wants a stalled machine to be obvious, and that is the state a player has to
 * spot to understand why the line stopped.
 */
function JobRing({ progress, w, h, accent }: { progress: number; w: number; h: number; accent: string }) {
  const full = progress >= 1
  const width = Math.max(2, Math.round(w * 0.5))
  return (
    <View
      style={{
        position: 'absolute',
        left: (w - width) / 2,
        top: h * 0.72,
        width,
        height: 3,
        borderRadius: 2,
        backgroundColor: '#00000055',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.round(progress * 100)}%`,
          height: '100%',
          backgroundColor: full ? colors.warn : accent,
        }}
      />
    </View>
  )
}

function Item({ type, size }: { type: ItemType; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: itemColor(type),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#0d0f14', fontWeight: '800', fontSize: Math.max(7, size * 0.55) }}>
        {type.charAt(0).toUpperCase()}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  board: { backgroundColor: colors.board, borderRadius: 10, position: 'relative' },
  cell: { position: 'absolute' },
  inset: { position: 'absolute' },
  centre: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  job: { position: 'absolute', top: '18%', right: '18%', fontSize: 9, fontWeight: '700' },
})
