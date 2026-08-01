# Level 001 — hand-designed fixture

The reference puzzle. It's the fixture for most simulator tests, the first thing a player ever sees, and the benchmark the Phase 3 generator gets measured against. Designed by hand precisely so there's a known-good answer to compare machine output to.

## Design intent

Teach the core loop — transform, split, combine — in one puzzle, while forcing exactly one real decision.

**The decision:** the assembler needs two discs, but there's only one source emitting circles one at a time. So you must split the stream. The question is *where*.

- **Press, then split** — one press (5) + one splitter (3) = **8**
- **Split, then press** — one splitter (3) + two presses (5 each) = **13**

Both work. One is 5 cheaper. That's the whole lesson: transform before you split, not after. It's the single most transferable heuristic in the genre, and getting it wrong still lets you finish — you just come in over par, which is exactly the feeling the game is built around.

## Level file

```json
{
  "id": "001",
  "grid": { "width": 7, "height": 7 },
  "sources": [{ "pos": [0, 3], "rotation": 0, "emits": "circle" }],
  "sinks": [{ "pos": [6, 3], "rotation": 0 }],
  "target": { "type": "widget", "count": 5 },
  "max_ticks": 300,
  "available": ["conveyor", "splitter", "press", "assembler"],
  "recipes": {
    "press": { "circle": "disc" },
    "assembler": [{ "in": ["disc", "disc"], "out": "widget" }]
  },
  "par": 21
}
```

Merger is deliberately withheld. Four building types is enough to carry the lesson, and every extra type multiplies the generator's search space later.

## Reference solution

```
      x=0   1     2     3     4     5     6
y=2               ┌─────────────────┐
y=3  SRC──────►PRESS──►SPLIT──►──►ASSEMBLER──►SINK
```

| Building | Pos | Config | Cost |
|---|---|---|---|
| Conveyor | (1,3) | in W, out E | 1 |
| Press | (2,3) | rot 0 | 5 |
| Splitter | (3,3) | rot 0 → out N and E | 3 |
| Conveyor | (4,3) | in W, out E | 1 |
| Conveyor | (3,2) | in S, out E | 1 |
| Conveyor | (4,2) | in W, out E | 1 |
| Conveyor | (5,2) | in W, out S | 1 |
| Assembler | (5,3) | rot 0 → in W and N, out E | 8 |

**Total cost: 21.** Par is set to match.

Flow: source emits circles east. The press turns each into a disc. The splitter alternates — east feeds the assembler's `W` port directly, north routes up and over three conveyors into the assembler's `N` port. The assembler pairs them into a widget and pushes east into the sink.

## Expected delivery ticks

Hand-simulated 2026-08-01 from rules-spec **v0.2** (locked; all §15 defaults accepted). If any §15 row is ever changed, recompute these before implementing. (Note: §14 case 1 proper is a different fixture — a machine-free straight line, expected delivery tick 4. This level is case 1's companion timing fixture.)

- **First widget delivered: tick 12.**
- **Win (5th widget): tick 28** — steady state is one widget every 4 ticks (12, 16, 20, 24, 28), paced by the press: one disc every 2 ticks, and each widget needs two.

### Full trace to the first widget

Phases are cited as `p1`–`p8` per §6. Only state changes are listed; anything not mentioned is unchanged.

| Tick | Events |
|---|---|
| 1 | `p8` source emits circle 1 → (1,3) |
| 2 | `p4` press pulls circle 1 into its W buffer · `p6` press starts job A, timer 2 · `p8` emits circle 2 → (1,3) |
| 3 | `p4` press pulls circle 2 (buffer freed when job A started) · `p7` job A timer → 0 · `p8` emits circle 3 → (1,3) |
| 4 | `p5` job A places **disc 1** in the press output buffer · `p6` press starts job B on circle 2 · `p8` (1,3) still full — **source stalls**, the first back-pressure |
| 5 | `p2` press pushes disc 1 into the splitter's W input buffer · `p4` press pulls circle 3 · `p6` splitter transfers disc 1 input → output buffer · `p7` job B timer → 0 · `p8` emits circle 4 |
| 6 | `p2` splitter pushes disc 1 **north** to (3,2), `next` flips to E · `p3` disc 1 advances (3,2) → (4,2) · `p5` job B places **disc 2** · `p6` press starts job C |
| 7 | `p2` press pushes disc 2 into the splitter · `p3` disc 1 → (5,2) · `p4` assembler pulls disc 1 into its **N** buffer; press pulls circle 4 · `p6` splitter transfers disc 2 |
| 8 | `p2` splitter pushes disc 2 **east** to (4,3), `next` flips to N · `p4` assembler pulls disc 2 into its **W** buffer · `p5` job C places disc 3 · `p6` assembler starts the widget job, timer 2; press starts job D |
| 9 | `p2` press pushes disc 3 into the splitter · `p6` splitter transfers disc 3 · `p7` assembler timer → 0 |
| 10 | `p2` splitter pushes disc 3 north · `p5` assembler places **widget 1** in its output buffer; press places disc 4 |
| 11 | `p2` assembler pushes widget 1 into the **sink's input buffer**; press pushes disc 4 into the splitter · `p3` disc 3 → (5,2) · `p4` assembler pulls disc 3 into its N buffer |
| 12 | **`p1` sink consumes widget 1 → `delivered[widget] = 1`** · `p2` splitter pushes disc 4 east · `p4` assembler pulls disc 4 into its W buffer · `p6` assembler starts widget job 2 |

Widget 2's job starts at T12 by the same arithmetic that started widget 1's at T8, and the pattern repeats every 4 ticks from there. **The press is the bottleneck** — one disc per 2 ticks, two discs per widget — so neither the assembler (duration 2) nor the belts ever constrain the rate. Deliveries land at 12, 16, 20, 24, **28**.

Note that the source stalls from T4 onward and stays mostly stalled: it produces one circle per tick and the press eats one per two. That back-pressure is working as designed and does not affect the cadence.

Once the simulator runs, these hand-computed numbers are the thing it has to match. Deriving them *after* the code exists defeats the purpose entirely.

## Reference solution as JSON

The §13-form solution matching the table above, for use as the Phase 1 test fixture:

```json
{
  "level_id": "001",
  "placements": [
    { "type": "conveyor", "pos": [1, 3], "in": "W", "out": "E" },
    { "type": "press", "pos": [2, 3], "rotation": 0 },
    { "type": "splitter", "pos": [3, 3], "rotation": 0 },
    { "type": "conveyor", "pos": [4, 3], "in": "W", "out": "E" },
    { "type": "conveyor", "pos": [3, 2], "in": "S", "out": "E" },
    { "type": "conveyor", "pos": [4, 2], "in": "W", "out": "E" },
    { "type": "conveyor", "pos": [5, 2], "in": "W", "out": "S" },
    { "type": "assembler", "pos": [5, 3], "rotation": 0 }
  ]
}
```

## Notes for the Phase 3 generator

- Par 21 is the verified cost of this solution. It is **not proven optimal** — proving optimality is the solver's job, and level 001 is a good first test of whether the solver can find something better than a human did.
- This puzzle has at least two materially different solutions (the split-placement choice), which is exactly the property the generator's fourth acceptance criterion tests for. Use it as the positive control.
- Build a negative control too: a puzzle with only one possible solution. The validator should reject it.
