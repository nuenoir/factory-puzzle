# Factory Puzzle

A daily factory-automation puzzle on a hex grid. Route items from sources, through
transformations, into a sink — scored against par like golf.

**[Play it](https://nuenoir.github.io/factory-puzzle/)** · **[Engineering note](docs/writeup.md)** — how the generator works, what it is allowed to claim, and what surprised me

## What's interesting here

The simulator is a standalone package with **zero rendering imports**. It is a pure
function of a level and a solution, and it is deliberately both the game engine *and*
the puzzle validator — which is what makes headless batch validation of generated
puzzles possible later.

The rules were specified before any code was written. [`docs/rules-spec.md`](docs/rules-spec.md)
defines the tick order, belt resolution, back-pressure, and scoring precisely enough that
two people implementing from it independently would agree on every test case. It is
authoritative: if the code and the spec disagree, the code is wrong.

That discipline paid for itself. The expected delivery ticks for the reference puzzle
(first widget on tick 12, win on tick 28) were **derived by hand on paper before the
simulator existed** — see [`docs/level-001.md`](docs/level-001.md) for the tick-by-tick
working. The implementation reproduces them exactly, which is stronger evidence of
correctness than any test written after the fact.

## Correctness

69 tests, covering the twelve cases the spec demands plus the rules those cases don't
reach on their own. Two things worth calling out:

- **An item-conservation invariant is asserted on every tick.** Emitted plus produced
  must equal in-world plus delivered plus consumed. It catches most movement bugs on the
  tick they happen rather than three features later.
- **The suite is mutation-tested.** A green suite is not automatically a correct suite —
  an earlier version passed against a simulator whose round-robin flag never flipped,
  because it asserted on item counts instead of observing the mechanic. Twenty seeded
  defects are now each confirmed to fail the suite.

## Layout

```
packages/sim/   the simulator — pure logic, no UI imports, no randomness
app/            Expo app (web; Android later from the same code)
levels/         level content as data
docs/           the spec, and the hand-designed reference puzzle
```

## Running it

```
npm install
npm test          # full suite
npm run typecheck
npm run web       # dev server
```

## Rules in brief

Pointy-top hex grid, odd-r offset coordinates. Six directions, 60° rotation. Conveyors
carry an explicit `{in, out}` pair rather than a rotation, so a single belt type turns
corners. Items are never destroyed: a blocked line backs up into a visible jam rather
than silently swallowing throughput. Cost is the sum of building costs, not a count, so
the real trade-off is whether a second press beats routing a belt around.

Full semantics in [`docs/rules-spec.md`](docs/rules-spec.md).
