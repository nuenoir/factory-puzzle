/**
 * The share card.
 *
 * Text, not an image. A block of text pastes into every messaging app there
 * is, needs nothing hosted — there is no server and there is not going to be
 * one — and survives being forwarded. Wordle's grid spread because it was
 * copyable, not because it was pretty.
 *
 * It must not spoil the puzzle. Cost and tick count say how well somebody did
 * without saying anything about where they put the splitter, which is the whole
 * trick: a score you can compare and an answer you cannot read off.
 */

import type { Result } from './history'

/** Where a reader goes to play the same day. No tracking parameters. */
export const PLAY_URL = 'nuenoir.github.io/factory-puzzle'

/**
 * A score as golf says it.
 *
 * `par` is the cheapest solution the validator's *search* found and was never
 * proven optimal, so coming in under it is a real outcome. Saying "1 under par"
 * rather than "-1" is worth the extra characters: it is the good news.
 */
export function scoreLine(result: Result): string {
  const toPar = result.cost - result.par
  const score = toPar < 0 ? `${-toPar} under par` : toPar === 0 ? 'Par' : `+${toPar}`
  return `${score} (${result.cost}) · ${result.ticks} ticks`
}

/**
 * The whole card, ready for the clipboard.
 *
 * The streak line is omitted below two days, because "1 day streak" is not an
 * achievement and padding a share with one makes the format look automated.
 */
export function shareText(result: Result, streak: number): string {
  const lines = [`⬢ Factory Puzzle #${result.day}`, scoreLine(result)]
  if (streak >= 2) lines.push(`${streak} day streak`)
  lines.push(PLAY_URL)
  return lines.join('\n')
}

/* ---- clipboard --------------------------------------------------------- */

/** Injected so the copy path is testable without a browser. */
export interface Clipboard {
  write(text: string): Promise<void>
}

/**
 * Copy, reporting whether it worked rather than throwing.
 *
 * `navigator.clipboard` needs a secure context and a user gesture, and refuses
 * in plenty of ordinary situations — an embedded webview, a denied permission,
 * an older browser. The caller shows the text for manual copying when this
 * returns false, so a refusal costs a tap and not the share.
 */
export async function copyShare(text: string, clipboard: Clipboard | null = defaultClipboard()): Promise<boolean> {
  if (clipboard === null) return false
  try {
    await clipboard.write(text)
    return true
  } catch {
    return false
  }
}

function defaultClipboard(): Clipboard | null {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return null
    return { write: (text) => navigator.clipboard.writeText(text) }
  } catch {
    return null
  }
}
