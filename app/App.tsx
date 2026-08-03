/**
 * Phase 2 — the playable board.
 *
 * The UI drives the simulator through the §13 stepping API (`createWorld`,
 * `step`, `snapshot`), never by calling `simulate` and animating a guess. That
 * matters: the factory you watch is the same run that gets scored, so an
 * animation can never disagree with the result.
 *
 * Editing rebuilds the world from scratch, which is also what resets the §9
 * round-robin flags — CLAUDE.md calls those the classic source of
 * non-determinism in this genre.
 *
 * The dependency runs one way only: app imports sim, never the reverse.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  costOf,
  createWorld,
  snapshot,
  stateKey,
  step,
  type PosTuple,
  type Rotation,
  type Snapshot,
  type World,
} from '@factory/sim'

import { Grid, type PointerPhase } from './components/Grid'
import { Palette, type Tool } from './components/Palette'
import { beltsFromPath, directionBetween, editReducer, placementAt } from './editor'
import { level } from './puzzle'
import { colors } from './theme'

type Status = 'idle' | 'running' | 'won' | 'jammed' | 'timeout'

/** Milliseconds per tick at each speed. The tween fills exactly this long. */
const SPEEDS = [
  { label: '0.5×', ms: 600 },
  { label: '1×', ms: 300 },
  { label: '2×', ms: 150 },
  { label: '4×', ms: 75 },
] as const

/** Sources and sinks are fixed by the level and not placeable (§4). */
const fixtureCells = new Set(
  [...level.sources, ...level.sinks].map((f) => `${f.pos[0]},${f.pos[1]}`),
)

export default function App() {
  const [placements, dispatch] = useReducer(editReducer, [])
  const [tool, setTool] = useState<Tool>('conveyor')
  const [rotation, setRotation] = useState<Rotation>(0)

  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [previous, setPrevious] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [playing, setPlaying] = useState(false)
  const [errors, setErrors] = useState<readonly string[]>([])
  const [speed, setSpeed] = useState(1)

  // Progress through the current tick, 0 to 1. The simulation is discrete;
  // this only decides where an item is drawn between two snapshots.
  const [progress, setProgress] = useState(1)
  const tickStartedAt = useRef(0)
  const [epoch, setEpoch] = useState(0)
  const tickMs = SPEEDS[speed].ms

  const worldRef = useRef<World | null>(null)
  const drag = useRef<{ path: PosTuple[]; anchor: PosTuple | null; terminus: PosTuple | null } | null>(null)

  const solution = useMemo(() => ({ level_id: level.id, placements }), [placements])
  const cost = useMemo(() => costOf(solution), [solution])

  /** Rebuild from the current placements. Any edit lands here, so any edit
   *  also rewinds the run to tick 0. */
  const rebuild = useCallback(() => {
    setPlaying(false)
    setStatus('idle')
    const built = createWorld(level, solution)
    if (!built.ok) {
      setErrors(built.errors.map((e) => e.message))
      setSnap(null)
      worldRef.current = null
      return
    }
    setErrors([])
    worldRef.current = built.world
    setSnap(snapshot(built.world))
    setPrevious(null)
    setProgress(1)
  }, [solution])

  useEffect(rebuild, [rebuild])

  const advance = useCallback(() => {
    const world = worldRef.current
    if (!world) return

    const before = stateKey(world)
    const wasShowing = snapshot(world)
    step(world)
    setPrevious(wasShowing)
    setSnap(snapshot(world))
    // Restart the tween from the top of this tick. A hidden tab gets no
    // animation frames at all, so tweening there would freeze items at their
    // starting positions while the simulation ran on — showing a board a tick
    // out of date. Snap straight to the truth instead.
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    tickStartedAt.current = Date.now()
    setProgress(hidden ? 1 : 0)
    setEpoch((e) => e + 1)

    // §10: win is checked first, then the tick limit.
    if ((world.delivered.get(level.target.type) ?? 0) >= level.target.count) {
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
    const id = setInterval(advance, tickMs)
    return () => clearInterval(id)
  }, [playing, advance, tickMs])

  /**
   * Drive the tween. One frame loop per tick, stopping when it lands — an
   * idle board should not be re-rendering sixty times a second.
   */
  useEffect(() => {
    if (progress >= 1) return
    let frame = 0
    let cancelled = false
    const run = () => {
      if (cancelled) return
      const elapsed = Date.now() - tickStartedAt.current
      const next = Math.min(1, tickMs <= 0 ? 1 : elapsed / tickMs)
      setProgress(next)
      if (next < 1) frame = requestAnimationFrame(run)
    }
    frame = requestAnimationFrame(run)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [epoch, tickMs, progress >= 1])

  const handleCell = useCallback(
    (phase: PointerPhase, x: number, y: number) => {
      if (phase === 'up') {
        drag.current = null
        return
      }
      const pos: PosTuple = [x, y]
      if (fixtureCells.has(`${x},${y}`)) return

      if (tool === 'delete') {
        dispatch({ kind: 'remove', pos })
        return
      }

      if (tool === 'conveyor') {
        // A cell holding a machine or fixture cannot become a belt, but it can
        // bookend one: drag out of a splitter and the first belt faces back at
        // it; drag into an assembler and the last belt points at it.
        const occupant = placementAt(placements, pos)
        const isBuilding = fixtureCells.has(`${x},${y}`) || (occupant !== undefined && occupant.type !== 'conveyor')

        if (phase === 'down') {
          drag.current = isBuilding
            ? { path: [], anchor: pos, terminus: null }
            : { path: [pos], anchor: null, terminus: null }
          if (!isBuilding) dispatch({ kind: 'placeMany', placements: beltsFromPath([pos]) })
          return
        }

        const state = drag.current
        if (!state || state.terminus) return
        const ends = { anchor: state.anchor, terminus: null }

        const last = state.path.length > 0 ? state.path[state.path.length - 1] : state.anchor
        if (!last || (last[0] === x && last[1] === y)) return

        if (isBuilding) {
          if (state.path.length === 0) return
          if (!directionBetween(last, pos)) return
          state.terminus = pos
          dispatch({ kind: 'placeMany', placements: beltsFromPath(state.path, { ...ends, terminus: pos }) })
          return
        }

        // Dragging back onto the previous cell undoes the last step.
        const previous = state.path.length >= 2 ? state.path[state.path.length - 2] : null
        if (previous && previous[0] === x && previous[1] === y) {
          state.path.pop()
          dispatch({ kind: 'placeMany', placements: beltsFromPath(state.path, ends) })
          return
        }

        // Ignore jumps (a fast drag) and self-crossings — a conveyor has one
        // in and one out, so a path may not visit a cell twice.
        if (!directionBetween(last, pos)) return
        if (state.path.some((p) => p[0] === x && p[1] === y)) return

        state.path.push(pos)
        dispatch({ kind: 'placeMany', placements: beltsFromPath(state.path, ends) })
        return
      }

      // Machines: tap an empty cell to place, tap your own building to turn it.
      if (phase !== 'down') return
      const existing = placementAt(placements, pos)
      if (existing && existing.type === tool) dispatch({ kind: 'rotate', pos })
      else dispatch({ kind: 'place', placement: { type: tool, pos, rotation } })
    },
    [tool, rotation, placements],
  )

  const delivered = snap ? snap.delivered[level.target.type] ?? 0 : 0
  const overPar = cost - level.par
  const finished = status === 'won' || status === 'jammed' || status === 'timeout'
  const runnable = snap !== null && errors.length === 0

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Factory Puzzle</Text>
        <Text style={styles.subtitle}>
          Level {level.id} — deliver {level.target.count} {level.target.type}
        </Text>
      </View>

      {snap ? (
        <Grid
          snapshot={snap}
          previous={previous}
          progress={progress}
          duration={level.durations?.press ?? 2}
          width={level.grid.width}
          height={level.grid.height}
          onCell={handleCell}
        />
      ) : (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>This layout is not valid</Text>
          {errors.map((message) => (
            <Text key={message} style={styles.errorLine}>
              {message}
            </Text>
          ))}
        </View>
      )}

      <Palette
        available={level.available}
        tool={tool}
        rotation={rotation}
        onTool={setTool}
        onRotate={() => setRotation(((rotation + 60) % 360) as Rotation)}
      />

      <View style={styles.hud}>
        <Stat label="Tick" value={snap ? `${snap.tick}` : '—'} />
        <Stat label={level.target.type} value={`${delivered} / ${level.target.count}`} />
        <Stat label="Cost" value={`${cost}`} />
        <Stat
          label={`Par ${level.par}`}
          value={overPar === 0 ? 'E' : overPar > 0 ? `+${overPar}` : `${overPar}`}
          tone={overPar <= 0 ? 'good' : 'bad'}
        />
      </View>

      <View style={styles.controls}>
        <Button label={playing ? 'Pause' : 'Run'} onPress={() => setPlaying((p) => !p)} disabled={!runnable || finished} primary />
        <Button label="Step" onPress={advance} disabled={!runnable || playing || finished} />
        <Button label="Reset" onPress={rebuild} disabled={!runnable} />
        <Button label="Clear" onPress={() => dispatch({ kind: 'clear' })} disabled={placements.length === 0} />
      </View>

      <View style={styles.speedRow}>
        <Text style={styles.speedLabel}>Speed</Text>
        {SPEEDS.map((option, index) => (
          <Pressable
            key={option.label}
            testID={`speed-${index}`}
            onPress={() => setSpeed(index)}
            style={({ pressed }) => [
              styles.speed,
              index === speed && styles.speedOn,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={[styles.speedText, index === speed && styles.speedTextOn]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.status, statusTone(status)]}>{statusText(status, snap?.tick ?? 0, placements.length)}</Text>
    </ScrollView>
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
      testID={`btn-${label.toLowerCase()}`}
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

function statusText(status: Status, tick: number, placed: number): string {
  if (status === 'won') return `Solved on tick ${tick}.`
  if (status === 'jammed') return 'Jammed — nothing can move. Edit the line and run again.'
  if (status === 'timeout') return 'Out of ticks.'
  if (status === 'running') return 'Running.'
  if (placed === 0) return 'Pick a building and drag on the board to start.'
  return 'Press Run to start the factory.'
}

function statusTone(status: Status) {
  if (status === 'won') return { color: colors.good }
  if (status === 'jammed' || status === 'timeout') return { color: colors.bad }
  return { color: colors.faint }
}

const styles = StyleSheet.create({
  screen: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen, padding: 20, minHeight: '100%' },
  header: { alignItems: 'center', marginBottom: 14 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  errorBox: { backgroundColor: colors.panel, borderRadius: 10, padding: 16, maxWidth: 460 },
  errorTitle: { color: colors.bad, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  errorLine: { color: colors.muted, fontSize: 12, marginTop: 2 },
  hud: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' },
  stat: {
    backgroundColor: colors.panel,
    borderColor: colors.panelEdge,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 78,
  },
  statLabel: { color: colors.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 },
  controls: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' },
  button: {
    borderWidth: 1,
    borderColor: colors.panelEdge,
    backgroundColor: colors.panel,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  buttonPrimary: { backgroundColor: '#2b3550', borderColor: '#3d4a6e' },
  buttonPressed: { opacity: 0.7 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  buttonLabelPrimary: { color: '#cfe0ff' },
  buttonLabelDisabled: { color: colors.faint },
  status: { marginTop: 12, fontSize: 13, textAlign: 'center' },
  speedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  speedLabel: { color: colors.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginRight: 2 },
  speed: {
    borderWidth: 1,
    borderColor: colors.panelEdge,
    backgroundColor: colors.panel,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  speedOn: { borderColor: '#3d4a6e', backgroundColor: '#2b3550' },
  speedText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  speedTextOn: { color: '#cfe0ff' },
})
