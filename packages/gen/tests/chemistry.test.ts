/**
 * docs/generation-spec.md §4 stages A and B.
 *
 * These two stages are the reason a batch is cheap, and they are also where a
 * wrong answer is most dangerous: stage A's rejection is reported as *proven*
 * unsolvable, so a false negative would put a lie in the write-up.
 */

import { describe, expect, it } from 'vitest'
import type { Level } from '@factory/sim'

import { isProducible, machineFloor, reachableTypes } from '../src/index'

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'gen-test',
    grid: { width: 7, height: 7 },
    sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
    sinks: [{ pos: [6, 3], rotation: 0 }],
    target: { type: 'widget', count: 5 },
    max_ticks: 300,
    available: ['conveyor', 'splitter', 'merger', 'press', 'assembler'],
    recipes: {},
    par: 0,
    ...overrides,
  }
}

/** The level-001 chemistry: circle -> disc, disc + disc -> widget. */
const level001 = makeLevel({
  recipes: {
    press: { circle: 'disc' },
    assembler: [{ in: ['disc', 'disc'], out: 'widget' }],
  },
})

describe('§4 stage A — reachability', () => {
  it('starts from the source types', () => {
    expect([...reachableTypes(makeLevel())]).toEqual(['circle'])
  })

  it('closes over press and assembler recipes', () => {
    expect([...reachableTypes(level001)].sort()).toEqual(['circle', 'disc', 'widget'])
    expect(isProducible(level001)).toBe(true)
  })

  it('needs a same-type assembler pair reachable only once', () => {
    // disc + disc -> widget. One press feeding a splitter supplies both ports
    // over time, so `disc` being reachable once is enough.
    expect(reachableTypes(level001).has('widget')).toBe(true)
  })

  it('rejects a target the chemistry cannot reach', () => {
    const orphan = makeLevel({
      target: { type: 'gadget', count: 5 },
      recipes: { press: { circle: 'disc' } },
    })
    expect(isProducible(orphan)).toBe(false)
  })

  it('does not fire an assembler whose second input is unreachable', () => {
    const missing = makeLevel({
      recipes: {
        press: { circle: 'disc' },
        assembler: [{ in: ['disc', 'plate'], out: 'widget' }],
      },
    })
    expect(isProducible(missing)).toBe(false)
    expect(reachableTypes(missing).has('plate')).toBe(false)
  })

  it('terminates on a recipe cycle', () => {
    const cyclic = makeLevel({
      target: { type: 'circle', count: 1 },
      recipes: { press: { circle: 'disc', disc: 'circle' } },
    })
    expect([...reachableTypes(cyclic)].sort()).toEqual(['circle', 'disc'])
  })

  it('ignores recipes whose machine the level does not offer', () => {
    // A press recipe is not a route to anything if the level has no press.
    // Catching this at stage A makes it a proof, and free, instead of a
    // bounded search that finds nothing and can conclude far less.
    const noPress = makeLevel({
      available: ['conveyor', 'assembler'],
      recipes: level001.recipes,
    })
    expect([...reachableTypes(noPress)]).toEqual(['circle'])
    expect(isProducible(noPress)).toBe(false)
  })

  it('ignores assembler recipes when no assembler is available', () => {
    const noAssembler = makeLevel({
      available: ['conveyor', 'press'],
      recipes: level001.recipes,
    })
    expect([...reachableTypes(noAssembler)].sort()).toEqual(['circle', 'disc'])
    expect(isProducible(noAssembler)).toBe(false)
  })
})

describe('§4 stage B — machine floor', () => {
  it('is null when the target cannot be produced', () => {
    expect(machineFloor(makeLevel({ target: { type: 'gadget', count: 1 } }))).toBeNull()
  })

  it('needs nothing when the target is already a source type', () => {
    const floor = machineFloor(makeLevel({ target: { type: 'circle', count: 5 } }))
    expect(floor).toEqual({ cost: 0, machines: new Map() })
  })

  it('counts one press per distinct type, not one per derivation step', () => {
    // disc + disc -> widget could be read as needing two presses. It does not:
    // a splitter fans one press's output into both ports, so the floor is
    // press(5) + assembler(8) = 13.
    const floor = machineFloor(level001)
    expect(floor?.cost).toBe(13)
    expect(floor?.machines.get('disc')).toBe('press')
    expect(floor?.machines.get('widget')).toBe('assembler')
    expect(floor?.machines.size).toBe(2)
  })

  it('is a true lower bound on the level-001 reference solution', () => {
    // The hand-designed solution costs 21 — the floor ignores the conveyors
    // and the splitter, both of which only add cost.
    expect(machineFloor(level001)?.cost).toBeLessThanOrEqual(21)
  })

  it('counts two presses when the pair really is two distinct types', () => {
    const twoChains = makeLevel({
      sources: [{ pos: [0, 3], rotation: 0, emits: 'circle' }],
      recipes: {
        press: { circle: 'disc', disc: 'plate' },
        assembler: [{ in: ['disc', 'plate'], out: 'widget' }],
      },
    })
    const floor = machineFloor(twoChains)
    // disc and plate each need their own press, plus the assembler: 5+5+8.
    expect(floor?.cost).toBe(18)
    expect(floor?.machines.size).toBe(3)
  })

  it('picks the cheaper of two ways to make the same type', () => {
    const both = makeLevel({
      target: { type: 'widget', count: 1 },
      recipes: {
        press: { circle: 'widget' },
        assembler: [{ in: ['circle', 'circle'], out: 'widget' }],
      },
    })
    // A press costs 5 and an assembler 8; both reach widget from circle.
    expect(machineFloor(both)?.cost).toBe(5)
  })

  it('terminates on a recipe cycle without claiming a bogus floor', () => {
    const cyclic = makeLevel({
      target: { type: 'gadget', count: 1 },
      recipes: { press: { circle: 'disc', disc: 'circle' } },
    })
    expect(machineFloor(cyclic)).toBeNull()
  })
})
