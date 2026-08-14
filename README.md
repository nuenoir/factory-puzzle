# Factory Puzzle

A daily factory-automation puzzle on a hex grid. Route items from sources, through
transformations, into a sink — scored against par like golf.

**[Play it](https://nuenoir.github.io/factory-puzzle/)** · **[Engineering note](docs/writeup.md)** — how the generator works, what it is allowed to claim, and what surprised me

## What's interesting here

**One function is both the game and the validator.** The simulator is a pure function of
a level and a solution, with zero rendering imports, no randomness and no clock. That is
why the same code that runs in your browser can play ten thousand generated candidates
headlessly. There is no second implementation to drift, so when the validator says a
puzzle is solvable it means *this exact engine* played it and won.

**The rules were written before the code.** [`docs/rules-spec.md`](docs/rules-spec.md)
defines the tick order, belt resolution, back-pressure and scoring precisely enough that
two people implementing from it independently would agree on every test case. It is
authoritative: if the code and the spec disagree, the code is wrong.

That paid for itself. The reference puzzle's delivery ticks — first widget on tick 12,
win on tick 28 — were **derived by hand on paper before the simulator existed**
([`docs/level-001.md`](docs/level-001.md) has the working). The implementation reproduces
them exactly, which is stronger evidence than any test written afterwards.

## The generator, and what it may claim

Puzzles are invented by a program and then judged by another one, which plays each
candidate before letting it through. A level ships only if it is solvable, non-trivial,
within budget, and has **more than one materially different solution** — because a puzzle
with exactly one answer is a lock, not an automation problem.

The interesting part is what the validator is allowed to *say*. Fifty candidates from one
seed, fully reproducible with `npm run generate -- --count 50 --seed 1`:

| Outcome | Count | Claim |
|---|---:|---|
| accepted | 7 | — |
| rejected, **proven** impossible | 11 | a proof: no arrangement could help |
| rejected, **bounded** search | 32 | "not found within the search we allowed" |

Those two rejection classes never share a code, and every log line carries the caps the
search ran under. Conflating a proof with an empty search would overstate what the tool
knows, which is the kind of thing a reader who knows search would catch immediately.

Two findings from the write-up worth the click: a *bounded* rejection turned out to hide a
**provable** impossibility about port counts that no amount of searching would have found;
and a change that made the search better also made `par` more honest, because par is the
cheapest solution *found*, so every gap in the search had been shipping as a puzzle scored
too generously.

## Correctness

**277 tests.** Two habits do most of the work:

- **An item-conservation invariant is asserted every tick.** Emitted plus produced must
  equal in-world plus delivered plus consumed. It catches movement bugs on the tick they
  happen rather than three features later.
- **The suite is mutation-tested** — 30 seeded defects, each confirmed to fail it. A green
  suite is not automatically a correct one: an earlier version passed against a simulator
  whose round-robin flag never flipped, because it counted items instead of watching the
  mechanic. Several mutations exist purely to stop a specific bug returning quietly.

The daily loop is tested end to end on real generated puzzles, and rebuilt through the
gesture layer — taps and drags rather than solver output — because the worst bug in the
project lived in the editing path and every test at the time used the one hand-made level
that happened not to exercise it.

## Layout

```
packages/sim/   the simulator — pure logic, no UI imports, no randomness
packages/gen/   the generator and the validator; the validator *is* simulate
app/            Expo app (web today, Android configured)
levels/         001.json is the hand-designed reference; daily.json is the pool
artifacts/      the rejection log — the deliverable, not a by-product
docs/           the two specs, the engineering note, the release checklist
```

## Running it

```
npm install
npm test                              # full suite
npm run typecheck
npm run web                           # dev server
npm run generate -- --count 50 --seed 1   # regenerate the batch and its log
```

## Rules in brief

Pointy-top hex grid, odd-r offset coordinates. Six directions, 60° rotation. Conveyors
carry an explicit `{in, out}` pair rather than a rotation, so one belt type turns corners.
Items are never destroyed: a blocked line backs up into a visible jam rather than silently
swallowing throughput. Cost is the sum of building costs, not a count, so the real
trade-off is whether a second press beats routing a belt around.

Full semantics in [`docs/rules-spec.md`](docs/rules-spec.md); the generator's rules and
its rejection codes in [`docs/generation-spec.md`](docs/generation-spec.md).
