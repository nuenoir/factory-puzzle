/**
 * The building palette.
 *
 * Only what the level offers (§12 `available`), each labelled with its §4
 * cost, plus a delete tool. Rotation applies to the next machine placed;
 * conveyors ignore it, because their direction comes from the drag path
 * rather than a rotation (§4).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { COST, ROTATIONS, type PlaceableType, type Rotation } from '@factory/sim'

import { buildingStyles, colors } from '../theme'

export type Tool = PlaceableType | 'delete'

interface PaletteProps {
  readonly available: readonly PlaceableType[]
  readonly tool: Tool
  readonly rotation: Rotation
  readonly onTool: (tool: Tool) => void
  readonly onRotate: () => void
}

export function Palette({ available, tool, rotation, onTool, onRotate }: PaletteProps) {
  const rotatable = tool !== 'delete' && tool !== 'conveyor'

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {available.map((type) => (
          <Tile
            key={type}
            testID={`tool-${type}`}
            label={buildingStyles[type].label || 'BELT'}
            sub={`${COST[type]}`}
            accent={buildingStyles[type].accent}
            selected={tool === type}
            onPress={() => onTool(type)}
          />
        ))}
        <Tile
          testID="tool-delete"
          label="ERASE"
          sub="—"
          accent={colors.bad}
          selected={tool === 'delete'}
          onPress={() => onTool('delete')}
        />
      </View>

      <View style={styles.hintRow}>
        {rotatable ? (
          <Pressable testID="rotate" onPress={onRotate} style={({ pressed }) => [styles.rotate, pressed && styles.pressed]}>
            <Text style={styles.rotateLabel}>Rotate {rotation}°</Text>
          </Pressable>
        ) : null}
        <Text style={styles.hint}>{hintFor(tool)}</Text>
      </View>
    </View>
  )
}

function hintFor(tool: Tool): string {
  if (tool === 'delete') return 'Tap or drag over buildings to remove them.'
  if (tool === 'conveyor') return 'Drag across cells to lay a belt. Corners follow your path.'
  return 'Tap to place. Tap it again to turn it.'
}

interface TileProps {
  readonly testID: string
  readonly label: string
  readonly sub: string
  readonly accent: string
  readonly selected: boolean
  readonly onPress: () => void
}

function Tile({ testID, label, sub, accent, selected, onPress }: TileProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        selected && { borderColor: accent, backgroundColor: accent + '22' },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.tileLabel, { color: selected ? accent : colors.muted }]}>{label}</Text>
      <Text style={styles.tileCost}>{sub}</Text>
    </Pressable>
  )
}

export { ROTATIONS }

const styles = StyleSheet.create({
  wrap: { marginTop: 14, alignItems: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  tile: {
    borderWidth: 1,
    borderColor: colors.panelEdge,
    backgroundColor: colors.panel,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 62,
  },
  tileLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  tileCost: { color: colors.faint, fontSize: 10, marginTop: 1 },
  pressed: { opacity: 0.7 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  rotate: {
    borderWidth: 1,
    borderColor: colors.panelEdge,
    backgroundColor: colors.panel,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  rotateLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  hint: { color: colors.faint, fontSize: 12, flexShrink: 1 },
})
