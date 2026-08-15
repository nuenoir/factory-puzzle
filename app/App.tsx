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
  type Placement,
  type PosTuple,
  type Rotation,
  type Level,
  type Snapshot,
  type World,
} from '@factory/sim'

import { Grid, type PointerPhase } from './components/Grid'
import { Palette, type Tool } from './components/Palette'
import { editReducer, toolFor } from './editor'
import { today } from './daily'
import { loadHistory, record, resultFor, saveHistory, stats } from './history'
import { copyShare, shareText } from './share'
import { statusAfterStep, type StepOutcome } from './run'
import { nextHint } from './coach'
import { onCell, type Drag } from './gesture'
import { TUTORIAL_STEPS, currentStep, markTutorialDone, stepNumber, tutorialDone } from './tutorial'
import tutorialJson from '../levels/tutorial.json'
import { colors } from './theme'

/**
 * The one clock read in the app.
 *
 * Resolved once at module scope rather than held in state: everything below
 * treats the level as a constant, and a board that swapped itself out from
 * under a half-built factory at midnight would be a worse bug than a session
 * left open overnight showing yesterday's puzzle until it is reloaded.
 */
const daily = today()

/** The teaching board. Its own small level, so a first attempt cannot spoil a daily. */
const TUTORIAL_LEVEL = tutorialJson as unknown as Level

/** `idle` is a UI state — nothing has been stepped yet. The rest come from §10. */
type Status = 'idle' | StepOutcome

/** Milliseconds per tick at each speed. The tween fills exactly this long. */
const SPEEDS = [
  { label: '0.5×', ms: 600 },
  { label: '1×', ms: 300 },
  { label: '2×', ms: 150 },
  { label: '4×', ms: 75 },
] as const

/**
 * A score as golf says it. Par is the cheapest solution the validator's search
 * found and was never proven optimal, so "under" is a real thing to land on and
 * deserves saying out loud rather than showing as a negative number.
 */
function scoreLabel(toPar: number): string {
  if (toPar < 0) return `${-toPar} under par`
  if (toPar === 0) return 'par'
  return `+${toPar}`
}

/** Sources and sinks are fixed by the level and not placeable (§4). */
const fixturesOf = (lv: Level) =>
  new Set([...lv.sources, ...lv.sinks].map((f) => `${f.pos[0]},${f.pos[1]}`))

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
  /** Ticks on which a target item reached the sink, for the share trace. */
  const deliveredAt = useRef<number[]>([])
  const drag = useRef<Drag | null>(null)
  /** The cell under the finger, so the board can respond to being touched. */
  const [activeCell, setActiveCell] = useState<PosTuple | null>(null)

  // Read once. Nothing else writes this key, so re-reading would only ever
  // return what we last put there.
  const [history, setHistory] = useState(loadHistory)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle')
  const [hintsHidden, setHintsHidden] = useState(false)

  /**
   * Which board is on screen. A first visit opens on the tutorial, because the
   * game has no other way of explaining that belts are dragged and that two
   * buildings only connect when each faces the other.
   */
  const [mode, setMode] = useState<'tutorial' | 'daily'>(() => (tutorialDone() ? 'daily' : 'tutorial'))
  const level = mode === 'tutorial' ? TUTORIAL_LEVEL : daily.level
  const day = daily.day
  const fixtureCells = useMemo(() => fixturesOf(level), [level])

  // `advance` and `bank` are memoised on an empty dependency list, so they read
  // the current level and mode through refs. Capturing them would leave a mode
  // switch scoring against the board the player had just left.
  const levelRef = useRef(level)
  levelRef.current = level
  const modeRef = useRef(mode)
  modeRef.current = mode

  // Keyed on the level too: switching board changes `level_id`, and a solution
  // still carrying the old one is rejected outright by §12 validation.
  const solution = useMemo(() => ({ level_id: level.id, placements }), [level.id, placements])
  const cost = useMemo(() => costOf(solution), [solution])
  const costRef = useRef(cost)
  costRef.current = cost

  /**
   * Bank a win. Called from the tick that detects it, with the cost taken from
   * a ref rather than the closure — `advance` is memoised on an empty
   * dependency list and would otherwise bank whatever the cost was when the
   * callback was created, which is zero.
   */
  const bank = useCallback((ticks: number) => {
    setHistory((previousHistory) => {
      const next = record(previousHistory, {
        day: daily.day,
        levelId: daily.level.id,
        par: daily.level.par,
        cost: costRef.current,
        ticks,
        // Collected tick by tick as the run happened, so the trace on the share
        // card is of the run that was scored rather than a re-derivation of it.
        deliveredAt: [...deliveredAt.current],
      })
      if (next !== previousHistory) saveHistory(next)
      return next
    })
  }, [])

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
    // Any edit rewinds the run, so the trace has to start over with it.
    deliveredAt.current = []
    setSnap(snapshot(built.world))
    setPrevious(null)
    setProgress(1)
  }, [level, solution])

  useEffect(rebuild, [rebuild])

  const advance = useCallback(() => {
    const world = worldRef.current
    if (!world) return

    const active = levelRef.current
    const before = stateKey(world)
    const deliveredBefore = world.delivered.get(active.target.type) ?? 0
    const wasShowing = snapshot(world)
    step(world)
    // One entry per item, since a tick can deliver more than one.
    const deliveredNow = world.delivered.get(active.target.type) ?? 0
    for (let i = deliveredBefore; i < deliveredNow; i += 1) deliveredAt.current.push(world.tickCount)
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

    const outcome = statusAfterStep({
      delivered: world.delivered.get(active.target.type) ?? 0,
      target: active.target.count,
      tickCount: world.tickCount,
      maxTicks: active.max_ticks,
      stalled: stateKey(world) === before,
    })
    setStatus(outcome)
    if (outcome !== 'running') setPlaying(false)
    if (outcome === 'won') {
      // A tutorial win teaches; it does not count towards a streak or a share.
      if (modeRef.current === 'daily') bank(world.tickCount)
      else markTutorialDone()
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
      const pos: PosTuple = [x, y]
      setActiveCell(phase === 'up' ? null : pos)

      // All the actual reasoning lives in `gesture.ts`, where it can be replayed
      // without a screen. It used to live here, which is why a guard that made
      // four levels in five unbuildable could ship untested.
      const outcome = onCell(phase, pos, {
        tool,
        rotation,
        placements,
        drag: drag.current,
        isFixture: ([cx, cy]) => fixtureCells.has(`${cx},${cy}`),
      })
      drag.current = outcome.drag
      for (const action of outcome.actions) dispatch(action)
    },
    [tool, rotation, placements],
  )

  const delivered = snap ? snap.delivered[level.target.type] ?? 0 : 0
  const overPar = cost - level.par
  const finished = status === 'won' || status === 'jammed' || status === 'timeout'
  const runnable = snap !== null && errors.length === 0

  const summary = useMemo(() => stats(history, day), [history])
  const banked = resultFor(history, day)

  // One sentence about why the factory is not working, derived from the same
  // snapshot the board is drawn from. `hidden` lets a player who finds it
  // patronising put it away for the session.
  const hint = useMemo(
    () =>
      hintsHidden || mode === 'tutorial'
        ? null
        : nextHint({ level, snapshot: snap, status, cost, hasErrors: errors.length > 0 }),
    [hintsHidden, mode, level, snap, status, cost, errors.length],
  )

  const board = useMemo(() => ({ snapshot: snap, status }), [snap, status])
  const tutorialStep = mode === 'tutorial' ? currentStep(board) : null

  /**
   * Today's board, held while the tutorial borrows the screen.
   *
   * The two levels are different sizes, so the boards cannot simply coexist —
   * daily placements on the tutorial's 5x3 grid are out of bounds and the world
   * refuses to build. Clearing is therefore forced, but the cost of it need not
   * land on the player: you get one puzzle a day, and losing a half-built
   * factory to a curious tap on "How to play" is a bad trade for a reminder.
   */
  const [stash, setStash] = useState<readonly Placement[]>([])

  /** Leave the tutorial for today's puzzle, and do not offer it again. */
  const leaveTutorial = useCallback(() => {
    markTutorialDone()
    dispatch({ kind: 'clear' })
    if (stash.length > 0) dispatch({ kind: 'placeMany', placements: stash })
    setStash([])
    setTool((t) => toolFor(t, daily.level.available))
    setMode('daily')
  }, [stash])

  /**
   * Back to the tutorial. Reachable at any time, because the rule it teaches is
   * the one people forget — and now genuinely free, since today's board comes
   * back exactly as it was left.
   */
  const replayTutorial = useCallback(() => {
    setStash(placements)
    dispatch({ kind: 'clear' })
    setTool((t) => toolFor(t, TUTORIAL_LEVEL.available))
    setMode('tutorial')
  }, [placements])

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Factory Puzzle</Text>
          {mode === 'daily' ? (
            <Pressable testID="btn-how-to-play" onPress={replayTutorial} hitSlop={8}>
              <Text style={styles.howTo}>How to play</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.subtitle}>
          {mode === 'tutorial' ? 'How to play' : `Day ${day}`} — deliver {level.target.count} {level.target.type}
        </Text>
        {mode === 'daily' && (summary.currentStreak > 0 || banked !== undefined) ? (
          <Text style={styles.streak}>
            {summary.currentStreak > 0
              ? `${summary.currentStreak} day streak`
              : 'Solved today'}
            {banked !== undefined
              ? ` · today ${scoreLabel(banked.cost - banked.par)}`
              : ''}
          </Text>
        ) : null}
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
          active={activeCell}
          hintAt={hint?.at ?? null}
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
        <Button label={playing ? 'Pause' : 'Run'} testID="btn-run" onPress={() => setPlaying((p) => !p)} disabled={!runnable || finished} primary />
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

      {/* In the tutorial the script leads and the coach stays quiet, so the
          player is following one voice rather than two. */}
      {mode === 'tutorial' ? (
        <View style={[styles.hintBox, styles.tutorialBox]} testID="tutorial-step">
          <View style={styles.tutorialBody}>
            <Text style={styles.tutorialCount}>
              {tutorialStep === null ? 'Done' : `Step ${stepNumber(board)} of ${TUTORIAL_STEPS.length}`}
            </Text>
            <Text style={styles.hintText}>
              {tutorialStep?.text ?? 'That is the whole game. Today’s puzzle is bigger, but it is the same three ideas.'}
            </Text>
          </View>
          <Pressable testID="btn-leave-tutorial" onPress={leaveTutorial} hitSlop={8}>
            <Text style={styles.tutorialSkip}>{tutorialStep === null ? "Today’s puzzle" : 'Skip'}</Text>
          </Pressable>
        </View>
      ) : null}

      {hint ? (
        <View style={[styles.hintBox, hint.tone === 'problem' && styles.hintProblem, hint.tone === 'win' && styles.hintWin]} testID="hint">
          <Text style={styles.hintText}>{hint.text}</Text>
          <Pressable
            testID="btn-hide-hints"
            onPress={() => setHintsHidden(true)}
            hitSlop={8}
            accessibilityLabel="Hide hints"
          >
            <Text style={styles.hintDismiss}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={[styles.status, statusTone(status)]}>{statusText(status, snap?.tick ?? 0, placements.length)}</Text>

      {/* Offered whenever today is banked, not only in the moment of winning —
          people come back to share, and a button that vanished on reload would
          make the streak they are proud of unshareable. */}
      {banked !== undefined ? (
        <View style={styles.shareBox}>
          <Text style={styles.shareCard} testID="share-card">{shareText(banked, summary.currentStreak)}</Text>
          <Button
            label={copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Select and copy above' : 'Share'}
            testID="btn-share"
            onPress={async () => {
              const ok = await copyShare(shareText(banked, summary.currentStreak))
              setCopied(ok ? 'ok' : 'failed')
            }}
            primary={copied !== 'ok'}
          />
        </View>
      ) : null}
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
  testID,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  primary?: boolean
  /** Given explicitly where the label changes with state — deriving the id from
   *  the label means Run becomes btn-pause the moment it is pressed. */
  testID?: string
}) {
  return (
    <Pressable
      testID={testID ?? `btn-${label.toLowerCase()}`}
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
  streak: { color: colors.good, fontSize: 12, fontWeight: '700', marginTop: 6, letterSpacing: 0.3 },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 14,
    maxWidth: 460,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelEdge,
    // A left rule carries the tone, so the box itself stays quiet enough to sit
    // under the board without competing with it.
    borderLeftWidth: 3,
    borderLeftColor: colors.muted,
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  howTo: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  tutorialBox: { borderLeftColor: colors.good, alignItems: 'center' },
  tutorialBody: { flexShrink: 1, gap: 3 },
  tutorialCount: {
    color: colors.good,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tutorialSkip: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  hintProblem: { borderLeftColor: colors.warn },
  hintWin: { borderLeftColor: colors.good },
  hintText: { color: colors.text, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  hintDismiss: { color: colors.faint, fontSize: 13, fontWeight: '700' },
  shareBox: {
    marginTop: 18,
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.panelEdge,
    padding: 16,
    maxWidth: 460,
  },
  shareCard: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    // Shown as well as copied, so a refused clipboard still leaves something
    // the player can select by hand.
    fontVariant: ['tabular-nums'],
  },
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
