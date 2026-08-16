/**
 * What the controls announce themselves as.
 *
 * The board is plain React Native `View`s partly because that is "easier to
 * make accessible" (CLAUDE.md), and none of it had been checked. Every control
 * rendered as a bare `<div tabindex="0">` with no role. They now render as real
 * `<button type="button">` elements, which is what these tests pin.
 *
 * Browsers activate a `<button>` on both Enter and Space and give a
 * `div[tabindex]` neither, so the change should fix keyboard activation as well
 * as the announcement — but that half is reasoned from the platform, not
 * measured: activation by keystroke is trusted-input behaviour, and the browser
 * available here delivers key events with an empty `key` field, so it cannot be
 * demonstrated either way. What is asserted below is the DOM shape, which is
 * the part this codebase actually controls.
 *
 * These tests render for real rather than asserting on props. Mocking
 * `react-native` to `react-native-web` and calling `renderToStaticMarkup` needs
 * no new dependency — both are already here, one as the web target and one via
 * the react-dom the app already ships — and it means the assertions are about
 * what reaches the DOM, not about what the props are called. RNW quietly
 * ignores some accessibility props, so that distinction is the whole point.
 *
 * Only the first render: no effects run, so the board is still building. That
 * is enough for the controls, which is what this file is about.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', async () => await import('react-native-web'))

async function render(node: unknown): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(node as never)
}

/** Every opening tag that the browser will let a keyboard reach. */
const focusable = (html: string) => html.match(/<[a-z]+[^>]*tabindex="0"[^>]*>/g) ?? []

const withTestId = (html: string, id: string) =>
  (html.match(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`)) ?? [])[0] ?? ''

async function renderApp(): Promise<string> {
  const { createElement } = await import('react')
  const App = (await import('./App')).default
  return render(createElement(App))
}

async function renderPalette(tool: string): Promise<string> {
  const { createElement } = await import('react')
  const { Palette } = await import('./components/Palette')
  return render(
    createElement(Palette, {
      available: ['conveyor', 'press'],
      tool,
      rotation: 0,
      onTool: () => {},
      onRotate: () => {},
    } as never),
  )
}

describe('every control a keyboard can reach', () => {
  it('says what it is', async () => {
    const html = await renderApp()
    const reachable = focusable(html)
    expect(reachable.length).toBeGreaterThan(6)

    // A bare <div tabindex="0"> is the shape that broke Space.
    const roleless = reachable.filter((tag) => !tag.includes('role='))
    expect(roleless, `${roleless.length} focusable elements with no role`).toEqual([])
  })

  it('gives the controls that are not a word of their own a label', async () => {
    // "✕", "Skip" and "How to play" are not self-describing read out of context.
    const html = await renderApp()
    for (const id of ['btn-how-to-play', 'btn-hide-hints']) {
      const tag = withTestId(html, id)
      if (tag === '') continue // not rendered in this mode; the tutorial one is covered below
      expect(tag, `${id} has no label`).toMatch(/aria-label="/)
    }
  })

  it('exposes which speed is current, rather than leaving it to a border colour', async () => {
    const html = await renderApp()
    expect(withTestId(html, 'speed-1')).toMatch(/aria-selected="true"/)
    expect(withTestId(html, 'speed-3')).toMatch(/aria-selected="false"/)
  })
})

describe('the palette', () => {
  it('marks the tool in hand as selected', async () => {
    const html = await renderPalette('press')
    expect(withTestId(html, 'tool-press')).toMatch(/aria-selected="true"/)
    expect(withTestId(html, 'tool-conveyor')).toMatch(/aria-selected="false"/)
  })

  it('reads the cost as a cost', async () => {
    // The tile shows "PRESS" over "5"; spoken, a bare number after a word is
    // not a price.
    const html = await renderPalette('press')
    expect(withTestId(html, 'tool-press')).toMatch(/aria-label="[^"]*cost/i)
    // ERASE has no cost, so it must not claim one.
    expect(withTestId(html, 'tool-delete')).not.toMatch(/cost/i)
  })

  it('gives every tile a role, so Space works on all of them', async () => {
    const html = await renderPalette('conveyor')
    const reachable = focusable(html)
    expect(reachable.length).toBeGreaterThan(2)
    expect(reachable.filter((tag) => !tag.includes('role="button"'))).toEqual([])
  })
})
