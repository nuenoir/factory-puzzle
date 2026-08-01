import { describe, expect, it } from 'vitest'

import { SPEC_VERSION } from '../src/index.js'

/**
 * Placeholder suite. It asserts nothing about the simulation — it exists so the
 * toolchain is provably wired up before any real logic lands: TypeScript
 * compiles, Vitest discovers tests, and imports resolve across the workspace.
 *
 * Replace this file with the §14 cases as Phase 1 proceeds.
 */
describe('toolchain', () => {
  it('implements a known rules-spec version', () => {
    expect(SPEC_VERSION).toBe('0.2')
  })
})
