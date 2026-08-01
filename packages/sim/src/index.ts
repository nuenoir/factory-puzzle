/**
 * The headless factory simulator.
 *
 * Nothing is implemented yet — Phase 1 starts here, tests first.
 * The contract is `simulate(level, solution) => SimResult`, defined in
 * docs/rules-spec.md §13. The twelve tests it must pass are in §14.
 *
 * This package must never import React, Expo, the DOM, or anything from app/.
 * It is both the game engine and the Phase 3 puzzle validator; a rendering
 * import here kills headless batch validation and takes Phase 3 with it.
 */

/** The rules-spec version this package implements. Bump only alongside the spec. */
export const SPEC_VERSION = '0.2'
