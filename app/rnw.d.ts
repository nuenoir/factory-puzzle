/**
 * `accessibilitySelected` is a react-native-web prop that React Native's own
 * types do not declare.
 *
 * It is not interchangeable with the `accessibilityState` the types *do* offer.
 * Rendered side by side through RNW 0.21:
 *
 *   accessibilityState={{ selected: true }}  ->  <button role="button">
 *   accessibilitySelected={true}             ->  <button role="button" aria-selected="true">
 *
 * The typed one emits nothing. Since this project's web target *is* RNW, the
 * prop that works is the right one and the type is what needs widening.
 *
 * The `import` is load-bearing: it makes this file a module, which is what
 * turns `declare module` from a replacement into an augmentation. Without it
 * the whole of `react-native` would be shadowed by this one interface.
 */

import 'react-native'

declare module 'react-native/Libraries/Components/Pressable/Pressable' {
  interface PressableProps {
    /** RNW-only; emits `aria-selected`. */
    accessibilitySelected?: boolean
  }
}
