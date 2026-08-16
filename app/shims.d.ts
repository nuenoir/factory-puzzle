/**
 * `react-dom/server` ships no types and `@types/react-dom` is not installed.
 * Only `app/a11y.test.ts` needs it, to render the real components to markup and
 * assert on what reaches the DOM rather than on what the props are called. One
 * function signature is a smaller thing to carry than another dev dependency,
 * and adding one is not a decision to make quietly.
 *
 * This file must stay free of imports: an ambient module declaration is only
 * ambient in a file that is not itself a module. The RNW prop widening lives in
 * `rnw.d.ts` for the opposite reason.
 */

declare module 'react-dom/server' {
  export function renderToStaticMarkup(element: unknown): string
}

/**
 * `react-native-web` is untyped too, and is only ever named in one place: the
 * `vi.mock` in a11y.test.ts that swaps it in for `react-native`. The components
 * themselves keep importing `react-native` and keep its types.
 */
declare module 'react-native-web'
