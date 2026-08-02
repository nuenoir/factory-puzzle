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

import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { BuildingSnapshot, Direction, ItemType, Snapshot } from '@factory/sim'

import {
  GAP,
  arrow,
  boardSize,
  buildingStyles,
  cellOrigin,
  cellSizeFor,
  colors,
  hexHeight,
  itemColor,
} from '../theme'

interface GridProps {
  readonly snapshot: Snapshot
  readonly width: number
  readonly height: number
}

export function Grid({ snapshot, width, height }: GridProps) {
  const { width: windowWidth } = useWindowDimensions()
  const w = cellSizeFor(Math.min(windowWidth - 24, 520), width)
  const board = boardSize(w, width, height)

  const byCell = new Map<string, BuildingSnapshot>()
  for (const b of snapshot.buildings) byCell.set(`${b.x},${b.y}`, b)

  const cells = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(<Cell key={`${x},${y}`} x={x} y={y} w={w} building={byCell.get(`${x},${y}`)} />)
    }
  }

  return (
    <View testID="board" style={[styles.board, { width: board.width + GAP * 2, height: board.height + GAP * 2 }]}>
      {cells}
    </View>
  )
}

interface CellProps {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly building: BuildingSnapshot | undefined
}

function Cell({ x, y, w, building }: CellProps) {
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

          {/* A conveyor holds its item in the cell itself (§5). */}
          {building.type === 'conveyor' && building.item !== null ? (
            <View style={[styles.centre]}>
              <Item type={building.item} size={itemSize} />
            </View>
          ) : null}

          {/* Machines and sinks hold items in capacity-1 buffers, drawn just
              inside the port they arrived through so queues stay visible. */}
          {Object.entries(building.inputs).map(([dir, item]) =>
            item === null ? null : (
              <Buffered key={`buf-${dir}`} d={dir as Direction} w={w} h={h} size={bufferSize} type={item} />
            ),
          )}
          {building.output !== null && building.outPorts.length > 0 ? (
            <Buffered d={building.outPorts[0] as Direction} w={w} h={h} size={bufferSize} type={building.output} />
          ) : null}

          {building.job !== null ? (
            <Text style={[styles.job, { color: building.job.timer > 0 ? colors.muted : colors.warn }]}>
              {building.job.timer > 0 ? building.job.timer : '!'}
            </Text>
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

/** A buffered item, pulled in from its port towards the middle of the cell. */
function Buffered({ d, w, h, size, type }: { d: Direction; w: number; h: number; size: number; type: ItemType }) {
  const c = edgeCentre(d, w, h)
  const x = c.x + (w / 2 - c.x) * 0.5
  const y = c.y + (h / 2 - c.y) * 0.5
  return (
    <View style={{ position: 'absolute', left: x - size / 2, top: y - size / 2 }}>
      <Item type={type} size={size} />
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
