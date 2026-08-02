/**
 * Phase 2 — the board.
 *
 * The UI drives the simulator through the §13 stepping API (`createWorld`,
 * `step`, `snapshot`), never by calling `simulate` and animating a guess. That
 * matters: the factory you watch on screen is the same run that gets scored,
 * so an animation can never disagree with the result.
 *
 * The dependency runs one way only: app imports sim, never the reverse.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { costOf, createWorld, snapshot, stateKey, step, type Snapshot, type World } from '@factory/sim'

import { Grid } from './components/Grid'
import { level, solution } from './puzzle'
import { colors } from './theme'

type Status = 'idle' | 'running' | 'won' | 'jammed' | 'timeout'

const TICK_MS = 300
const cost = costOf(solution)

/** Build a fresh world, which also resets the §9 round-robin flags. */
function freshWorld(): World {
  const built = createWorld(level, solution)
  if (!built.ok) {
    throw new Error(`Level 001 does not validate:\n${built.errors.map((e) => e.message).join('\n')}`)
  }
  return built.world
}

export default function App() {
  const worldRef = useRef<World>(undefined as unknown as World)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [playing, setPlaying] = useState(false)

  const reset = useCallback(() => {
    const world = freshWorld()
    worldRef.current = world
    setSnap(snapshot(world))
    setStatus('idle')
    setPlaying(false)
  }, [])

  useEffect(reset, [reset])

  const advance = useCallback(() => {
    const world = worldRef.current
    if (!world) return

    const before = stateKey(world)
    step(world)
    const next = snapshot(world)
    setSnap(next)

    // §10: win is checked first, then the tick limit.
    if ((next.delivered[level.target.type] ?? 0) >= level.target.count) {
      setStatus('won')
      setPlaying(false)
    } else if (world.tickCount >= level.max_ticks) {
      setStatus('timeout')
      setPlaying(false)
    } else if (stateKey(world) === before) {
      // §13: a fixpoint is permanent under determinism, so this is a real jam.
      setStatus('jammed')
      setPlaying(false)
    } else {
      setStatus('running')
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(advance, TICK_MS)
    return () => clearInterval(id)
  }, [playing, advance])

  if (!snap) return <View style={styles.screen} />

  const delivered = snap.delivered[level.target.type] ?? 0
  const overPar = cost - level.par
  const finished = status === 'won' || status === 'jammed' || status === 'timeout'

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Factory Puzzle</Text>
        <Text style={styles.subtitle}>Level {level.id}</Text>
      </View>

      <Grid snapshot={snap} width={level.grid.width} height={level.grid.height} />

      <View style={styles.hud}>
        <Stat label="Tick" value={`${snap.tick} / ${level.max_ticks}`} />
        <Stat label={level.target.type} value={`${delivered} / ${level.target.count}`} />
        <Stat label="Cost" value={`${cost}`} />
        <Stat label="Par" value={overPar === 0 ? 'E' : overPar > 0 ? `+${overPar}` : `${overPar}`} tone={overPar <= 0 ? 'good' : 'bad'} />
      </View>

      <View style={styles.controls}>
        <Button label={playing ? 'Pause' : 'Run'} onPress={() => setPlaying((p) => !p)} disabled={finished} primary />
        <Button label="Step" onPress={advance} disabled={playing || finished} />
        <Button label="Reset" onPress={reset} />
      </View>

      <Text style={[styles.status, statusTone(status)]}>{statusText(status, snap.tick)}</Text>
    </View>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone === 'good' && { color: colors.good }, tone === 'bad' && { color: colors.bad }]}>
        {value}
      </Text>
    </View>
  )
}

function Button({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  primary?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonLabel, primary && styles.buttonLabelPrimary, disabled && styles.buttonLabelDisabled]}>
        {label}
      </Text>
    </Pressable>
  )
}

function statusText(status: Status, tick: number): string {
  if (status === 'won') return `Solved on tick ${tick}.`
  if (status === 'jammed') return 'Jammed — nothing can move. Reset to try again.'
  if (status === 'timeout') return 'Out of ticks.'
  if (status === 'running') return 'Running.'
  return 'Press Run to start the factory.'
}

function statusTone(status: Status) {
  if (status === 'won') return { color: colors.good }
  if (status === 'jammed' || status === 'timeout') return { color: colors.bad }
  return { color: colors.faint }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen, padding: 24 },
  header: { alignItems: 'center', marginBottom: 16 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  hud: { flexDirection: 'row', gap: 10, marginTop: 16 },
  stat: {
    backgroundColor: colors.panel,
    borderColor: colors.panelEdge,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 84,
  },
  statLabel: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  controls: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: {
    borderWidth: 1,
    borderColor: colors.panelEdge,
    backgroundColor: colors.panel,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  buttonPrimary: { backgroundColor: '#2b3550', borderColor: '#3d4a6e' },
  buttonPressed: { opacity: 0.7 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  buttonLabelPrimary: { color: '#cfe0ff' },
  buttonLabelDisabled: { color: colors.faint },
  status: { marginTop: 14, fontSize: 13 },
})
