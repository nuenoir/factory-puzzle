/**
 * The run trace on the share card.
 *
 * It stands in for the animation the roadmap asked for, so it has to carry the
 * same information — when the factory started delivering and how steadily — and
 * it has to survive being pasted into an app that chooses its own font.
 */

import { describe, expect, it } from 'vitest'

import { TRACE_WIDTH, deliveryTrace } from './trace'

describe('deliveryTrace', () => {
  it('is all idle when nothing was delivered', () => {
    expect(deliveryTrace([], 30)).toBe('▁'.repeat(TRACE_WIDTH))
  })

  it('is exactly as wide as asked, whatever the run', () => {
    for (const ticks of [1, 8, 29, 300]) {
      expect(deliveryTrace([1, 4, 9], ticks)).toHaveLength(TRACE_WIDTH)
    }
  })

  it('puts the first tick in the first segment and the last in the last', () => {
    // Ticks are 1-based (§6). An off-by-one here would push the final delivery
    // past the end of the bar and lose it.
    const trace = deliveryTrace([1, 40], 40, 4)
    expect(trace.startsWith('█')).toBe(true)
    expect(trace.endsWith('█')).toBe(true)
  })

  it('shows the run-up before the first delivery', () => {
    // The shape worth sharing: a factory fills, then starts producing. Level
    // 001 delivers at 12, 16, 20, 24, 28 across a 28-tick run.
    const trace = deliveryTrace([12, 16, 20, 24, 28], 28, 10)
    expect(trace).toBe('▁▁▁█▁██▁██')
    // Nothing until the press has filled the assembler, then a steady beat.
    expect(trace.indexOf('█')).toBe(3)
  })

  it('separates a fast factory from a slow one', () => {
    const fast = deliveryTrace([2, 3, 4, 5, 6], 30)
    const slow = deliveryTrace([26, 27, 28, 29, 30], 30)
    expect(fast).not.toBe(slow)
    expect(fast.indexOf('█')).toBeLessThan(slow.indexOf('█'))
  })

  it('uses glyphs of one width, so the bar cannot stagger', () => {
    // Pasted into apps with no say over the font. Both marks come from the
    // block-elements range deliberately.
    const trace = deliveryTrace([1, 15], 30)
    expect(new Set(trace)).toEqual(new Set(['▁', '█']))
    expect([...trace].every((c) => c.charCodeAt(0) >= 0x2580 && c.charCodeAt(0) <= 0x259f)).toBe(true)
  })

  it('ignores ticks that cannot have happened', () => {
    expect(deliveryTrace([0, -3, Number.NaN, Infinity], 20)).toBe('▁'.repeat(TRACE_WIDTH))
  })

  it('survives a zero-tick run without piling everything up', () => {
    expect(deliveryTrace([], 0)).toBe('▁'.repeat(TRACE_WIDTH))
    expect(deliveryTrace([1], 0)).toHaveLength(TRACE_WIDTH)
  })

  it('collapses two deliveries in one segment rather than widening the bar', () => {
    expect(deliveryTrace([5, 6], 100, 4)).toHaveLength(4)
  })
})
