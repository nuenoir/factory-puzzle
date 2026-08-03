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

import {
  deliveriesBetween,
  deriveTransits,
  ease,
  jobProgress,
  lerpPoint,
  pulseGeometry,
  type Anchor,
  type Delivery,
  type Transit,
} from '../motion'

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
  shade,
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
  /** The cell under the pointer, lifted so the board can answer the touch. */
  readonly active?: readonly [number, number] | null
}

export function Grid({
  snapshot,
  width,
  height,
  onCell,
  previous = null,
  progress = 1,
  duration = 2,
  active = null,
}: GridProps) {
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

  // Items live in their own layer above the board so they can travel between
  // cells instead of being clipped inside one.
  const transits = deriveTransits(previous, snapshot)
  const deliveries = deliveriesBetween(previous, snapshot)

  // Belts carrying an item that did not move are blocked, and their chevrons
  // stop. Flowing chevrons on a deadlocked line would be the same lie the
  // item tween is careful not to tell.
  const blocked = new Set<string>()
  for (const t of transits) {
    if (t.from === null || t.to === null) continue
    if (t.from.dir !== undefined || t.to.dir !== undefined) continue
    if (t.from.x === t.to.x && t.from.y === t.to.y) blocked.add(`${t.from.x},${t.from.y}`)
  }

  const cells = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(
        <Cell
          key={`${x},${y}`}
          x={x}
          y={y}
          w={w}
          building={byCell.get(`${x},${y}`)}
          duration={duration}
          active={active !== null && active[0] === x && active[1] === y}
          flow={blocked.has(`${x},${y}`) ? null : snapshot.tick + progress}
        />,
      )
    }
  }

  return (
    <View
      testID="board"
      style={[styles.board, { width: board.width + GAP * 2, height: board.height + GAP * 2 }]}
      {...(onCell ? responder.panHandlers : {})}
    >
      {cells}
      {deliveries.map((delivery) => (
        <DeliveryPulse key={delivery.key} delivery={delivery} w={w} progress={progress} />
      ))}
      {transits.map((transit) => (
        <TravellingItem key={transit.key} transit={transit} w={w} progress={progress} />
      ))}
    </View>
  )
}

/**
 * A ring expanding out of a sink as something lands in it.
 *
 * Worth having because it is the one moment the item tween cannot show: a sink
 * being fed every tick has its buffer emptied and refilled together, so
 * occupancy never changes and a steady stream looks like a stationary item.
 * The pulse comes from the engine's own phase-1 consumption, not from
 * comparing pixels.
 */
function DeliveryPulse({ delivery, w, progress }: { delivery: Delivery; w: number; progress: number }) {
  const t = Math.min(1, Math.max(0, progress))
  if (t >= 1) return null

  const h = hexHeight(w)
  const { left, top } = cellOrigin(delivery.at.x, delivery.at.y, w)
  const { size, opacity } = pulseGeometry(w, t)

  return (
    <View
      style={{
        position: 'absolute',
        left: GAP + left + w / 2 - size / 2,
        top: GAP + top + h / 2 - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(1, Math.round(w * 0.045)),
        borderColor: itemColor(delivery.type),
        opacity,
      }}
    />
  )
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
  // One base size for every item: an arriving one grows into it and a consumed
  // one shrinks out of it, so nothing changes size the tick after it settles.
  const size = Math.round(w * 0.36)
  const t = Math.min(1, Math.max(0, progress))

  // A brand-new item grows into place; a consumed one shrinks away. Anything
  // that merely moved slides between the two anchors.
  const anchor = transit.to ?? transit.from
  if (anchor === undefined || anchor === null) return null
  const start = transit.from === null ? anchor : transit.from
  const end = transit.to === null ? anchor : transit.to

  const a = anchorPoint(start, w)
  const b = anchorPoint(end, w)
  const { x, y } = lerpPoint(a, b, t)

  // Roll while travelling, like an atom being carried along. Proportional to
  // the distance covered, so a short hop turns less than a long one and a
  // stationary item does not spin on the spot.
  const travelled = Math.hypot(b.x - a.x, b.y - a.y)
  const spin = travelled > 1 ? ease(t) * (travelled / w) * 180 : 0

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
      <Item type={transit.type} size={drawn} spin={spin} />
    </View>
  )
}

interface CellProps {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly building: BuildingSnapshot | undefined
  readonly duration: number
  readonly active: boolean
  /** Continuously rising phase for the belt chevrons, or null when blocked. */
  readonly flow: number | null
}

function Cell({ x, y, w, building, duration, active, flow }: CellProps) {
  const h = hexHeight(w)
  const { left, top } = cellOrigin(x, y, w)
  const style = building ? buildingStyles[building.type] : null
  const edge = style ? style.accent : colors.cellEdge

  // A machine mid-job glows, so a working line is legible at a glance and a
  // stalled one stands out beside it.
  const busy = building?.job != null
  const fill = style ? (busy ? shade(style.fill, 0.14) : style.fill) : colors.emptyCell

  const portSize = Math.max(5, Math.round(w * 0.15))

  return (
    <View
      testID={`cell-${x}-${y}`}
      style={[
        styles.cell,
        {
          left: left + GAP,
          top: top + GAP,
          width: w,
          height: h,
          // Lift the cell under the finger, so the board answers the touch.
          transform: active ? [{ scale: 1.09 }] : undefined,
          zIndex: active ? 2 : 0,
        },
      ]}
    >
      {/* Outline hexagon behind a slightly smaller fill hexagon. */}
      <Hexagon w={w} h={h} fill={active ? colors.text : edge + (building ? '77' : '')} lit={false} />
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

          {building.type === 'conveyor' ? (
            <BeltFlow
              w={w}
              h={h}
              inDir={building.inPorts[0] as Direction}
              outDir={building.outPorts[0] as Direction}
              accent={edge}
              phase={flow}
            />
          ) : null}

          <View style={styles.centre}>
            {building.type === 'conveyor' ? (
              <Text style={{ color: edge, opacity: 0.28, fontSize: Math.round(w * 0.26), fontWeight: '700' }}>
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

/**
 * A pointy-top hexagon: triangle, rectangle, triangle.
 *
 * The three pieces are shaded separately — lighter cap, plain middle, darker
 * base — so the cell reads as a solid object lit from above instead of a flat
 * patch of colour. It costs nothing: the geometry was already in three parts.
 */
function Hexagon({ w, h, fill, lit = true }: { w: number; h: number; fill: string; lit?: boolean }) {
  const cap = lit ? shade(fill, 0.16) : fill
  const base = lit ? shade(fill, -0.22) : fill
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
          borderBottomColor: cap,
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
          borderTopColor: base,
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

const CHEVRONS = 3

/**
 * Arrows drifting along a belt from its input edge to its output edge.
 *
 * They give the board motion even where no item happens to be passing, which
 * is most of it. One traversal per tick, so they run at exactly the speed an
 * item does — chevrons faster than the cargo would read as a different machine
 * entirely.
 *
 * `phase` is null when the belt is blocked, and then they stop and dim. A
 * deadlocked line has to look deadlocked (§8); flowing arrows over a jam would
 * undo the care taken everywhere else not to animate a lie.
 */
function BeltFlow({
  w,
  h,
  inDir,
  outDir,
  accent,
  phase,
}: {
  w: number
  h: number
  inDir: Direction
  outDir: Direction
  accent: string
  phase: number | null
}) {
  if (inDir === undefined || outDir === undefined) return null

  const from = edgeCentre(inDir, w, h)
  const to = edgeCentre(outDir, w, h)
  // A border-trick triangle points up, so turn it to face the way out.
  const angle = (Math.atan2(to.y - h / 2, to.x - w / 2) * 180) / Math.PI + 90
  const size = Math.max(3, Math.round(w * 0.13))

  return (
    <>
      {Array.from({ length: CHEVRONS }, (_, i) => {
        const offset = i / CHEVRONS
        const u = phase === null ? offset : (((phase + offset) % 1) + 1) % 1
        const x = from.x + (to.x - from.x) * u
        const y = from.y + (to.y - from.y) * u
        // Fade in and out at the ends so nothing pops at the cell boundary.
        const opacity = (phase === null ? 0.16 : 0.5) * Math.sin(u * Math.PI)

        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              opacity,
              transform: [{ rotate: `${angle}deg` }],
            }}
          >
            <View
              style={{
                width: 0,
                height: 0,
                borderLeftWidth: size / 2,
                borderRightWidth: size / 2,
                borderBottomWidth: size * 0.85,
                borderLeftColor: 'transparent',
                borderRightColor: 'transparent',
                borderBottomColor: accent,
              }}
            />
          </View>
        )
      })}
    </>
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

/**
 * An item, drawn as a little sphere rather than a flat disc: darker rim, a
 * specular highlight up and to the left, and a shadow beneath so it reads as
 * sitting *on* the board rather than printed into it. Same light direction as
 * the cells, which is what makes the two look like one scene.
 */
function Item({ type, size, spin = 0 }: { type: ItemType; size: number; spin?: number }) {
  const base = itemColor(type)
  const gloss = Math.round(size * 0.38)

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: base,
        borderWidth: Math.max(1, Math.round(size * 0.07)),
        borderColor: shade(base, -0.4),
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0px ${Math.max(1, Math.round(size * 0.09))}px ${Math.round(size * 0.18)}px rgba(0,0,0,0.45)`,
        transform: [{ rotate: `${spin}deg` }],
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: size * 0.12,
          left: size * 0.14,
          width: gloss,
          height: gloss * 0.72,
          borderRadius: gloss,
          backgroundColor: 'rgba(255,255,255,0.5)',
        }}
      />
      <Text style={{ color: shade(base, -0.62), fontWeight: '800', fontSize: Math.max(7, size * 0.5) }}>
        {type.charAt(0).toUpperCase()}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  board: {
    backgroundColor: colors.board,
    borderRadius: 10,
    position: 'relative',
    // The board sits in a shallow well, so the pieces on it read as raised.
    borderWidth: 1,
    borderColor: '#05070b',
    boxShadow: 'inset 0px 2px 10px rgba(0,0,0,0.55)',
  },
  cell: { position: 'absolute' },
  inset: { position: 'absolute' },
  centre: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  job: { position: 'absolute', top: '18%', right: '18%', fontSize: 9, fontWeight: '700' },
})
