/**
 * Phase 2 scaffold.
 *
 * Nothing playable yet — this screen exists to prove the architecture holds
 * end to end: the app imports the simulator, runs the level-001 reference
 * solution, and shows the result. The numbers below must match the ones
 * hand-derived in docs/level-001.md before any code existed (win on tick 28,
 * cost 21). If they ever disagree, the simulator is not what the spec says.
 *
 * The dependency runs one way only: app imports sim, never the reverse.
 */

import { StyleSheet, Text, View } from 'react-native'
import { simulate, type Level, type Placement, type Solution } from '@factory/sim'

import levelJson from '../levels/001.json'

const level = levelJson as unknown as Level

/** The reference solution from docs/level-001.md. */
const placements: Placement[] = [
  { type: 'conveyor', pos: [1, 3], in: 'W', out: 'E' },
  { type: 'press', pos: [2, 3], rotation: 0 },
  { type: 'splitter', pos: [3, 3], rotation: 0 },
  { type: 'conveyor', pos: [4, 3], in: 'W', out: 'E' },
  { type: 'conveyor', pos: [3, 2], in: 'S', out: 'E' },
  { type: 'conveyor', pos: [4, 2], in: 'W', out: 'E' },
  { type: 'conveyor', pos: [5, 2], in: 'W', out: 'S' },
  { type: 'assembler', pos: [5, 3], rotation: 0 },
]

const solution: Solution = { level_id: level.id, placements }

export default function App() {
  const result = simulate(level, solution)
  const relativeToPar = result.cost - level.par

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Factory Puzzle</Text>
      <Text style={styles.subtitle}>Level {level.id} — reference solution</Text>

      <View style={styles.card}>
        <Row label="Result" value={result.won ? 'Solved' : result.jammed ? 'Jammed' : 'Out of time'} />
        <Row label="Ticks" value={String(result.ticks)} />
        <Row label="Cost" value={`${result.cost} (par ${level.par})`} />
        <Row label="Score" value={relativeToPar === 0 ? 'E' : relativeToPar > 0 ? `+${relativeToPar}` : String(relativeToPar)} />
        <Row label="Footprint" value={String(result.footprint)} />
      </View>

      <Text style={styles.note}>
        Simulator wired up. Grid, palette, and controls come next.
      </Text>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12141a', padding: 24 },
  title: { color: '#f4f6fb', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#8b93a7', fontSize: 14, marginTop: 4, marginBottom: 24 },
  card: { backgroundColor: '#1b1e27', borderRadius: 12, padding: 20, minWidth: 280 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  label: { color: '#8b93a7', fontSize: 15 },
  value: { color: '#f4f6fb', fontSize: 15, fontWeight: '600' },
  note: { color: '#5d6478', fontSize: 13, marginTop: 24 },
})
