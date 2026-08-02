/**
 * The board. Plain React Native Views — a 7x7 grid is 49 elements, so there is
 * no case for a canvas or a game engine here (CLAUDE.md).
 *
 * The only input is a `Snapshot` from the simulator. Nothing is recomputed and
 * nothing is guessed: every dot on screen is a real item sitting in a real
 * cell or buffer, so what you see is exactly what the engine scored.
 *
 * Cells size themselves to the viewport so the whole board stays reachable on
 * a phone as well as a desktop.
 */

import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { BuildingSnapshot, Direction, ItemType, Snapshot } from '@factory/sim'

import { GAP, PORT, arrow, buildingStyles, cellSizeFor, colors, itemColor } from '../theme'

interface GridProps {
  readonly snapshot: Snapshot
  readonly width: number
  readonly height: number
}

export function Grid({ snapshot, width, height }: GridProps) {
  const { width: windowWidth } = useWindowDimensions()
  const cell = cellSizeFor(Math.min(windowWidth - 24, 460), width)

  const byCell = new Map<string, BuildingSnapshot>()
  for (const b of snapshot.buildings) byCell.set(`${b.x},${b.y}`, b)

  return (
    <View testID="board" style={styles.board}>
      {Array.from({ length: height }, (_, y) => (
        <View key={y} style={styles.row}>
          {Array.from({ length: width }, (_, x) => (
            <Cell key={x} x={x} y={y} cell={cell} building={byCell.get(`${x},${y}`)} />
          ))}
        </View>
      ))}
    </View>
  )
}

interface CellProps {
  readonly x: number
  readonly y: number
  readonly cell: number
  readonly building: BuildingSnapshot | undefined
}

function Cell({ x, y, cell, building }: CellProps) {
  const testID = `cell-${x}-${y}`
  const box = { width: cell, height: cell }

  if (!building) return <View testID={testID} style={[styles.cell, box, styles.emptyCell]} />

  const style = buildingStyles[building.type]
  const isConveyor = building.type === 'conveyor'
  const itemSize = Math.round(cell * 0.38)
  const bufferSize = Math.round(cell * 0.28)

  return (
    <View
      testID={testID}
      style={[styles.cell, box, { backgroundColor: style.fill, borderColor: style.accent + '55' }]}
    >
      {/* Input ports: dim bars. Output ports: bright bars. §4 port geometry. */}
      {building.inPorts.map((d) => (
        <View key={`in-${d}`} style={[styles.port, portPosition(d, cell), { backgroundColor: style.accent + '66' }]} />
      ))}
      {building.outPorts.map((d) => (
        <View key={`out-${d}`} style={[styles.port, portPosition(d, cell), { backgroundColor: style.accent }]} />
      ))}

      {isConveyor ? (
        <Text style={[styles.conveyorArrow, { color: style.accent, fontSize: Math.round(cell * 0.34) }]}>
          {arrow[building.outPorts[0] as Direction]}
        </Text>
      ) : (
        <Text style={[styles.label, { color: style.accent, fontSize: Math.max(6, Math.round(cell * 0.16)) }]}>
          {style.label}
        </Text>
      )}

      {/* A conveyor holds its item in the cell itself (§5). */}
      {isConveyor && building.item !== null ? <Item type={building.item} size={itemSize} /> : null}

      {/* Machines and sinks hold items in capacity-1 buffers, drawn at the
          port they arrived through so queues are visible. */}
      {Object.entries(building.inputs).map(([dir, item]) =>
        item === null ? null : (
          <View
            key={`buf-${dir}`}
            style={[styles.buffer, { width: bufferSize, height: bufferSize }, bufferPosition(dir as Direction, cell, bufferSize)]}
          >
            <Item type={item} size={bufferSize} />
          </View>
        ),
      )}
      {building.output !== null && building.outPorts.length > 0 ? (
        <View
          style={[
            styles.buffer,
            { width: bufferSize, height: bufferSize },
            bufferPosition(building.outPorts[0] as Direction, cell, bufferSize),
          ]}
        >
          <Item type={building.output} size={bufferSize} />
        </View>
      ) : null}

      {/* A running job, and the held-product stall §8 says to surface. */}
      {building.job !== null ? (
        <Text style={[styles.job, { color: building.job.timer > 0 ? colors.muted : colors.warn }]}>
          {building.job.timer > 0 ? building.job.timer : '!'}
        </Text>
      ) : null}

      {building.type === 'source' && building.emits !== null && cell > 40 ? (
        <Text style={styles.emits}>{building.emits.slice(0, 3)}</Text>
      ) : null}
    </View>
  )
}

function Item({ type, size }: { type: ItemType; size: number }) {
  return (
    <View
      style={[
        styles.item,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: itemColor(type) },
      ]}
    >
      <Text style={[styles.itemLabel, { fontSize: Math.max(7, size * 0.55) }]}>
        {type.charAt(0).toUpperCase()}
      </Text>
    </View>
  )
}

/** A bar hugging one edge of the cell. */
function portPosition(d: Direction, cell: number) {
  const inset = cell * 0.28
  if (d === 'N') return { top: 0, left: inset, right: inset, height: PORT }
  if (d === 'S') return { bottom: 0, left: inset, right: inset, height: PORT }
  if (d === 'W') return { left: 0, top: inset, bottom: inset, width: PORT }
  return { right: 0, top: inset, bottom: inset, width: PORT }
}

/** A buffered item, tucked just inside the edge of its port. */
function bufferPosition(d: Direction, cell: number, size: number) {
  const edge = PORT + 1
  const centred = Math.round(cell / 2 - size / 2)
  if (d === 'N') return { top: edge, left: centred }
  if (d === 'S') return { bottom: edge, left: centred }
  if (d === 'W') return { left: edge, top: centred }
  return { right: edge, top: centred }
}

const styles = StyleSheet.create({
  board: { backgroundColor: colors.board, padding: GAP * 2, borderRadius: 10 },
  row: { flexDirection: 'row' },
  cell: {
    margin: GAP / 2,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCell: { backgroundColor: colors.emptyCell, borderColor: colors.cellEdge },
  port: { position: 'absolute', borderRadius: 2 },
  label: { fontWeight: '700', letterSpacing: 0.3 },
  conveyorArrow: { fontWeight: '700', opacity: 0.5 },
  item: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  itemLabel: { color: '#0d0f14', fontWeight: '800' },
  buffer: { position: 'absolute' },
  job: { position: 'absolute', top: 1, right: 3, fontSize: 9, fontWeight: '700' },
  emits: { position: 'absolute', bottom: 3, fontSize: 8, color: colors.muted },
})
