/**
 * The run, as one line of text.
 *
 * The roadmap asks the share card to carry "a short animation of the line
 * running". A literal clip is out of reach for reasons that are architectural
 * rather than lazy: the board is plain React Native `View`s by rule, so there is
 * no canvas to capture, and producing one means a second renderer that exists
 * only for export and can drift from the real board. Nothing hosts a file
 * either.
 *
 * What the animation would actually *say* is how the factory ran — the pause
 * while it fills, then the beat of deliveries, fast or laboured, steady or not.
 * That is a sequence of tick numbers, and a sequence of tick numbers fits in a
 * line of text that pastes anywhere and spoils nothing. Wordle's grid is the
 * same trick: not a recording of the game, a trace of it.
 */

/** Idle segment, then a segment where something reached the sink. */
const IDLE = '▁'
const DELIVERY = '█'

/** Segments in the bar. Twenty reads clearly and wraps nowhere. */
export const TRACE_WIDTH = 20

/**
 * A bar of `TRACE_WIDTH` segments across the whole run, marking the segments in
 * which a delivery landed.
 *
 * Both block glyphs come from the same Unicode range and so share a width,
 * which matters: the bar is going to be pasted into apps with no say over the
 * font, and a trace that staggers is worse than no trace.
 */
export function deliveryTrace(
  deliveredAt: readonly number[],
  totalTicks: number,
  width: number = TRACE_WIDTH,
): string {
  if (width <= 0) return ''
  const segments = new Array<boolean>(width).fill(false)
  // A run of zero ticks cannot have delivered anything, and dividing by it
  // would put every mark in the same place.
  const span = Math.max(1, totalTicks)

  for (const tick of deliveredAt) {
    if (!Number.isFinite(tick) || tick < 1) continue
    // Ticks are 1-based (§6), so tick 1 belongs in the first segment and the
    // final tick in the last one rather than one past the end.
    const index = Math.min(width - 1, Math.floor(((tick - 1) / span) * width))
    segments[index] = true
  }

  return segments.map((hit) => (hit ? DELIVERY : IDLE)).join('')
}
