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

The grid is pointy-top hex in odd-r offset coordinates (§2): **odd rows sit half a cell to the right**, and `E`/`W` are row-aligned on every row, so the main line runs dead straight along `y=3`.

At rotation 0 the splitter forks `W → NE + SE`, and the assembler takes `W + NW`. The fork is symmetric: one branch goes up through `y=2`, the other down through `y=4`, and both rejoin at the assembler.

```
y=2            (4,2)──►(5,2)
                 ▲          ╲
                 │           ▼
y=3  SRC─►(1,3)─►PRESS─►SPLIT   (4,3)──►ASSEM─►SINK
     (0,3)       (2,3)  (3,3)     ▲      (5,3)  (6,3)
                 │                │
                 ▼                │
y=4            (4,4)──────────────┘
```

| Building | Pos | Config | Cost |
|---|---|---|---|
| Conveyor | (1,3) | in W, out E | 1 |
| Press | (2,3) | rot 0 → in W, out E | 5 |
| Splitter | (3,3) | rot 0 → in W, out NE and SE | 3 |
| Conveyor | (4,2) | in SW, out E | 1 |
| Conveyor | (5,2) | in W, out SE | 1 |
| Conveyor | (4,4) | in NW, out NE | 1 |
| Conveyor | (4,3) | in SW, out E | 1 |
| Assembler | (5,3) | rot 0 → in W and NW, out E | 8 |

**Total cost: 21.** Par is set to match.

Flow: the source emits circles east. The press turns each into a disc. The splitter alternates — the `NE` fork climbs to `y=2`, runs east, and drops into the assembler's `NW` port; the `SE` fork drops to `y=4` and climbs back into `(4,3)`, feeding the `W` port. The assembler pairs them into a widget and pushes east into the sink.

Both forks are two conveyors long, so the two discs of a pair arrive two ticks apart — set by the press, which is the real bottleneck at one disc every two ticks.

## Expected delivery ticks

Hand-simulated from rules-spec **v0.3** (hex) and since reproduced exactly by the simulator. If any §15 row is ever changed, recompute these before implementing.

- **First widget delivered: tick 12.**
- **Win (5th widget): tick 28** — steady state is one widget every 4 ticks (12, 16, 20, 24, 28).

Phases are cited as `p1`–`p8` per §6. Only state changes are listed.

| Tick | Events |
|---|---|
| 1 | `p8` source emits circle 1 → (1,3) |
| 2 | `p4` press pulls circle 1 · `p6` press starts job A, timer 2 · `p8` emits circle 2 |
| 3 | `p4` press pulls circle 2 · `p7` job A timer → 0 · `p8` emits circle 3 |
| 4 | `p5` job A places **disc 1** in the press output · `p6` press starts job B · `p8` (1,3) full — **source stalls** |
| 5 | `p2` press pushes disc 1 into the splitter · `p4` press pulls circle 3 · `p6` splitter transfers disc 1 to its output · `p7` job B → 0 |
| 6 | `p2` splitter pushes disc 1 **NE** to (4,2), `next` flips to SE · `p3` disc 1 advances (4,2) → (5,2) · `p5` job B places **disc 2** · `p6` press starts job C |
| 7 | `p2` press pushes disc 2 into the splitter · `p4` assembler pulls disc 1 from (5,2) into its **NW** buffer · `p6` splitter transfers disc 2 |
| 8 | `p2` splitter pushes disc 2 **SE** to (4,4), `next` flips to NE · `p3` disc 2 advances (4,4) → (4,3) · `p4` assembler pulls disc 2 into its **W** buffer · `p6` assembler starts the widget job |
| 9 | `p7` assembler timer → 0 |
| 10 | `p5` assembler places **widget 1** in its output buffer |
| 11 | `p2` assembler pushes widget 1 into the sink's input buffer |
| 12 | **`p1` sink consumes widget 1 → `delivered[widget] = 1`** |

The press is the bottleneck — one disc per two ticks, two discs per widget — so neither the assembler nor the belts ever constrain the rate. Deliveries land at 12, 16, 20, 24, **28**.

Note the fork is traversed in a single tick each way: the splitter pushes in `p2` and belt resolution advances the item again in `p3` of the same tick (§6). That is why two-conveyor branches cost no more latency than one.

## Notes for the Phase 3 generator

- Par 21 is the verified cost of this solution. It is **not proven optimal** — proving optimality is the solver's job, and level 001 is a good first test of whether the solver can find something better than a human did.
- This puzzle has at least two materially different solutions (the split-placement choice), which is exactly the property the generator's fourth acceptance criterion tests for. Use it as the positive control.
- Build a negative control too: a puzzle with only one possible solution. The validator should reject it.
- Hex widens the search space considerably: a conveyor now has 30 legal `{in, out}` pairs instead of 12, and buildings have six rotations instead of four. Budget for that when the solver's depth limit gets chosen.
