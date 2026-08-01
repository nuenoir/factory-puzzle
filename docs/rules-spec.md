# Factory Puzzle — Rules Spec v0.2

**Purpose.** This document defines the simulation semantics precisely enough that two competent engineers implementing from it independently would produce identical behaviour on every test case in §14. It is the input to the build, not a product document.

**How to use it.** Hand this to Claude Code *before* asking for any code. Every ambiguity resolved here is a bug you don't debug at turn 40. Anything marked `ASSUMPTION` is a decision made on your behalf — override it before you start, not after.

**v0.2 status — LOCKED 1 Aug 2026.** Amendments from the 2026-08-01 Phase-0 review, which found the v0.1 text underdetermined (two implementers would not have produced identical behaviour on §14). Every new decision is marked `ASSUMPTION` and has a row in §15; all 23 were confirmed as-is on 1 Aug. The expected tick numbers in §14 case 1 and `docs/level-001.md` were hand-derived from this text by four independent passes that agreed. **This document is now authoritative for Phase 1** — if code and spec disagree, the spec wins.

---

## 1. Non-goals for v1

Explicitly out of scope. Listed so they don't leak in during implementation.

- Infinite or scrolling grid. The grid is small and fully visible.
- Continuous item positions. Items occupy whole cells only.
- Resource extraction, upgrades, tech trees, currency.
- Multiple simultaneous target products.
- Undo history beyond a single step.
- Multiplayer, accounts, persistence beyond local storage.
- AI puzzle generation. Phase 3, not v1. The sim must exist first.

---

## 2. Coordinate system

- Square grid, `width × height`, default `7 × 7`. `ASSUMPTION`
- Origin `(0,0)` is top-left. `x` increases right, `y` increases down.
- Directions are `N` `E` `S` `W`. `N` = `y-1`, `E` = `x+1`, `S` = `y+1`, `W` = `x-1`.
- Rotation is one of `0 | 90 | 180 | 270`, applied clockwise. A building's port directions rotate with it.

Each cell holds **at most one building**. Each belt cell holds **at most one item**.

---

## 3. Item model

An item is an opaque **type string** (e.g. `"circle"`, `"red_circle"`). The engine assigns no meaning to it.

All transformation is defined by **recipe tables in the level file**, not in code. This matters: it decouples engine from content, and it means Phase 3 can generate new chemistry without touching the simulator.

```json
"recipes": {
  "press":     { "circle": "disc", "square": "plate" },
  "assembler": [
    { "in": ["disc", "plate"], "out": "widget" }
  ]
}
```

Assembler recipes are **unordered pairs**. `["disc","plate"]` and `["plate","disc"]` are the same recipe. Reject duplicate pairs at level-load with an error.

---

## 4. Building palette (v1)

Five buildings. `ASSUMPTION` — this is the minimum set that produces genuine solution diversity: without a 2→1 operation, puzzles collapse into pure routing.

| Building | Ports | Cost | Behaviour |
|---|---|---|---|
| **Conveyor** | 1 in, 1 out | 1 | Moves one item one cell per tick |
| **Splitter** | 1 in, 2 out | 3 | Round-robin across two outputs |
| **Merger** | 2 in, 1 out | 3 | Round-robin across two inputs |
| **Press** | 1 in, 1 out | 5 | `press_recipes[type] → type`, takes `duration` ticks |
| **Assembler** | 2 in, 1 out | 8 | Unordered pair → type, takes `duration` ticks |

`Source` and `Sink` also exist but are **fixed by the level** and not placeable. They cost nothing and do not count toward score.

Default `duration` is `2` ticks for Press and Assembler, configured per machine type in the level file's optional `durations` field (§12). `ASSUMPTION`

### Terminology: "machine"

**A *machine* is a splitter, merger, press, or assembler** — every placeable building except the conveyor. Conveyors, sources, and sinks are not machines. Every rule in §5, §6, and §8 that says "machine" means exactly these four. Splitters and mergers are machines with no recipes and no duration; items cross them via the transfer rule in §6 phase 6. `ASSUMPTION`

### Port geometry

**Conveyors are the exception: they are defined by an explicit `{in, out}` direction pair, not a rotation.** Any pair where `in ≠ out` is legal, which yields straight belts (`W→E`) and both corners (`W→S`, `W→N`) from a single building type at the same cost of 1.

This is not cosmetic. Without corners, every route is a straight line and the puzzle space collapses to nothing. Do not implement conveyors as rotation-only.

All other buildings use `rotation`. At rotation 0:

- Splitter: in `W`, out `N` and `E`
- Merger: in `W` and `N`, out `E`
- Press: in `W`, out `E`
- Assembler: in `W` and `N`, out `E`
- **Source**: out `E` (no input)
- **Sink**: in `W` (no output)

A connection exists between two adjacent buildings only if the upstream building's **output port faces** the downstream building, **and** the downstream building's **input port faces back**. Ports that don't face each other are not connected — no implicit adjacency transfer.

---

## 5. Buffers

- Every machine input port has a buffer of **capacity 1**. The sink's input port also has a capacity-1 buffer, filled in §6 phases 2/4/8 and drained in phase 1. `ASSUMPTION`
- Every machine has a **single** output buffer of **capacity 1** — including the splitter: its two output ports share one output buffer. A fully blocked splitter therefore holds at most 2 items and a fully blocked merger at most 3. `ASSUMPTION`
- Conveyors have no buffers; the cell itself holds the item.

Bounded buffers everywhere. No unbounded queues, which keeps state serialisable and the sim replayable.

---

## 6. The tick

**This is the heart of the spec. Get it wrong and nothing else matters.**

The tick resolves **downstream-first**, so vacancies propagate upstream within a single tick. This is what makes a line of items move together instead of crawling forward one item per tick.

**Tick numbering.** `tick_count` starts at `0` and increments after phase 8, so the first executed tick is tick 1. Every tick number in this spec and in §14 uses that convention. After the increment, check **win**, then **fail** (§10). `ASSUMPTION`

**Ordering within a phase.** Where a phase touches multiple buildings, process them in ascending `(y, x)` of their cell, one pass, applying effects immediately. Under §4's mutual-facing rule no two buildings can actually contend for the same cell or buffer (every input port faces exactly one cell, and that cell's output port faces exactly one neighbour), so this ordering has no observable effect — it is mandated so implementations are deterministic by construction rather than by proof. `ASSUMPTION`

Each tick executes these phases in strict order:

1. **Sinks consume.** For each sink whose **input buffer** holds an item, remove it and increment `delivered[type]`. Sinks accept **every** item type, not just the target. An item is counted the tick *after* it enters the sink (via phase 2, 4, or 8).
2. **Machines push output.** Any machine with a non-empty output buffer attempts to move that item to the connected building its output port faces. Succeeds only into: an empty connected conveyor cell, an empty machine input buffer **whose filter accepts the type (§8)**, or an empty sink input buffer. On success the output buffer empties. A splitter chooses which of its two outputs to try per §9.
3. **Belt paths advance.** See §7. Belt resolution moves items **between conveyor cells only** — never into a buffer. Input and sink buffers are filled by phases 2, 4, and 8 exclusively; output buffers by phases 5 and 6. An item pushed onto a conveyor cell in phase 2 is ordinary belt cargo in phase 3 of the same tick — there is no per-item once-per-tick movement limit across phases.
4. **Machines and sinks pull input.** For each machine input port (and each sink input buffer) that is empty: if the facing cell is a connected conveyor holding an item the port accepts (§8), move that item into the buffer. Port order within one building is `N, E, S, W`. A merger fills **both** input buffers this way; §9 governs the phase-6 transfer, not the pull.
5. **Machines finish jobs.** Any machine with an active job whose timer has reached `0` places its product into the output buffer — **only if the output buffer is empty**. If occupied, the job stays finished-but-held and the machine stalls.
6. **Machines start jobs; splitters and mergers transfer.** Any idle machine whose required inputs are all present and which has a valid recipe consumes those inputs and starts a job with `timer = duration`. A machine that finished in phase 5 of this tick is idle here — back-to-back jobs are intended. Splitters and mergers have no recipes; instead, if the output buffer is empty and an input buffer holds an item, move **exactly one** item from input buffer to output buffer (a merger picks which input per §9). An item therefore spends exactly one tick inside a splitter or merger — the same transit time as one conveyor cell. `ASSUMPTION`
7. **Timers decrement.** Every active job decrements its timer by 1 — including a job started in phase 6 of this same tick. A job started on tick `T` with duration `d` places its product in phase 5 of tick `T + d` and can push it in phase 2 of tick `T + d + 1`.
8. **Sources emit.** Each source emits one item of its configured type — one per tick, every tick it can — under the same acceptance rule as phase 2: an empty connected conveyor cell, an empty machine input buffer whose filter accepts the type, or an empty sink input buffer. `ASSUMPTION` (Yes, a source may feed a machine or even a sink directly. A source wired straight into a sink is a degenerate level; catching that is the Phase 3 validator's job, not the engine's.)

Then `tick_count += 1`; check win, then fail (§10).

---

## 7. Belt path resolution

Connected runs of conveyors form a **path**. Recompute paths whenever the player places or removes a building — never during a tick.

**A path is a maximal chain of mutually connected conveyors.** The building a path's tail faces — machine or sink — is not a member; transfer into it happens in phases 2 and 4, never in phase 3. Linearity is guaranteed by port geometry: every conveyor has one in and one out, so paths cannot branch or merge. `ASSUMPTION`

Resolve each path from its **output end backwards to its input end**. For cell `i` from `n` down to `0`: if the cell holds an item and the next cell in the path is empty, move it. (The tail cell `n` has no next cell within the path; its item waits for a phase-4 pull.)

Because resolution runs tail-first, cell `i+1` has already been vacated by the time cell `i` is evaluated. This produces the correct "whole train advances" behaviour.

**Cyclic paths.** A closed loop has no output end. Rule: find the empty cell with the lowest `(y, x)`; begin resolution at the cell immediately upstream of it and walk backwards around the loop, visiting every cell exactly once. If **no** cell in the loop is empty, the loop does not move this tick — a legal deadlock. Note that closed loops cannot arise in normal play — under §4's connection rule no external building can ever feed one — but the resolver must handle them because the test harness constructs seeded states (§13, §14 case 9). `ASSUMPTION`

**Path ordering.** When multiple paths exist, resolve them in ascending order of their input-end cell's `(y, x)`; cyclic paths (which have no input end) come after all linear paths, ordered by the lowest `(y, x)` cell in the loop. Paths are independent by construction, so this is belt-and-braces determinism. `ASSUMPTION`

---

## 8. Back-pressure

**Items are never destroyed.** If an item cannot advance, it waits.

`ASSUMPTION`, and a deliberate one. Destroying items on overflow is standard in the genre but wrong for a three-minute daily puzzle: it punishes silently. Waiting produces a jam the player can *see* and reason about. The congestion becomes readable feedback rather than a mystery.

Consequences, all intended:

- A full belt backs up to the source, and the source stops emitting.
- A machine whose output is blocked stalls, and its input buffers fill and back up.
- A **jam** is a legal terminal state, not an error. Surface it in the UI with a marker on the stalled building.

**Input filters.** A press's input buffer accepts only types with an entry in its recipe table. An assembler's input buffer accepts only types that appear in the `in` list of at least one assembler recipe — **outputs do not count**. Splitters, mergers, and sinks have **no filter**: they accept every item type. The filter applies to **every** route into a buffer — phase 4 pulls, phase 2 pushes, and phase 8 emissions — so an unusable item can never end up inside a machine. It jams outside, on the belt or in the upstream output buffer, where the player can see it. Do not consume-and-destroy. `ASSUMPTION`

**The assembler filter is item-level, not pair-aware:** it ignores what the other port already holds. Two discs routed into an assembler whose only recipe is `["disc","plate"]` fill both buffers and deadlock permanently. This is the player's routing mistake and should be shown clearly, exactly like the no-recipe jam. `ASSUMPTION`

---

## 9. Round-robin state

Splitters and mergers each hold a `next` flag persisting across ticks.

- **Port order.** The two ports are indexed `[0, 1]` in the order §4 lists them at rotation 0 — splitter outputs `[N, E]`, merger inputs `[W, N]` — and the indices rotate with the building. `ASSUMPTION`
- **Initial value.** `next = 0` when a run starts; run-reset sets it back to `0`. `ASSUMPTION`
- **Splitter** (runs in phase 2). Try the output indicated by `next`. If it cannot accept, try the other. If either succeeds, flip `next`. If both are blocked, the item waits and `next` does not change.
- **Merger** (runs in the phase-6 transfer). Take from the input indicated by `next` if its buffer holds an item, else from the other. If either yields an item, move it to the output buffer and flip `next`. If both are empty, nothing happens and `next` does not change. (Phase 4 fills both merger input buffers unconditionally; `next` chooses only which one feeds the output.)

This flag is **part of simulation state**. It must be reset on run-reset and serialised in any saved state. It is the most commonly missed source of non-determinism in this genre — flag it explicitly in the implementation.

---

## 10. Win and fail

**Win.** `delivered[target_type] >= target_count` at the end of any tick.

**Fail.** `tick_count >= max_ticks` without meeting the win condition. Jams are not a separate fail state — they just lead here (but see `jammed` in §13).

**Precedence.** Win is checked before fail at the same end-of-tick boundary, so a delivery during the final permitted tick is a win. At most `max_ticks` ticks execute. `ASSUMPTION`

`target_count` defaults to `5`. `ASSUMPTION` — greater than 1 so the player must build a factory that *repeats*, not a one-shot contraption. That single choice is what makes it an automation puzzle rather than a logic puzzle.

`max_ticks` defaults to `300`. `ASSUMPTION`

---

## 11. Scoring

Three metrics, computed at the tick the win condition is met:

- **`cost`** — **sum of the `Cost` column in §4** across all player-placed buildings. Not a raw building count. A raw count would make machines effectively free and reduce the whole optimisation to "use fewer tiles", which is degenerate. Summed cost forces the real trade-off: is a second press cheaper than routing a belt around?
- **`ticks`** — the tick number at which the win condition was met.
- **`footprint`** — area of the axis-aligned bounding box enclosing all player-placed buildings.

**Par** is a level-defined integer targeting `cost`. Display as golf: `−2`, `E`, `+3`.

v1 ranks on `cost` only, with `ticks` as tiebreak. `footprint` is computed and stored but not ranked — it exists so later leaderboards don't need a schema migration.

**On a failed run:** `ticks = max_ticks` (even if the sim early-exits on a fixpoint, §13). `cost` and `footprint` derive from the placements alone and are always computed; the `footprint` of zero placements is `0`. `ASSUMPTION`

---

## 12. Level schema

```json
{
  "id": "2026-08-15",
  "grid": { "width": 7, "height": 7 },
  "sources": [
    { "pos": [0, 3], "rotation": 0, "emits": "circle" }
  ],
  "sinks": [
    { "pos": [6, 3], "rotation": 0 }
  ],
  "target": { "type": "widget", "count": 5 },
  "max_ticks": 300,
  "available": ["conveyor", "splitter", "merger", "press", "assembler"],
  "recipes": {
    "press": { "circle": "disc" },
    "assembler": [{ "in": ["disc", "disc"], "out": "widget" }]
  },
  "durations": { "press": 2, "assembler": 2 },
  "par": 21
}
```

`durations` is optional, per machine type, defaulting to `2` for both (§4). It lives in the level file for the same reason recipes do: Phase 3 can generate new chemistry without touching the simulator. `ASSUMPTION` (The v0.1 example's `par` of 11 was below the 13 that this level's mandatory press + assembler alone cost — 21 matches the reference solution in `docs/level-001.md`.)

Blocked cells are deliberately omitted from v1. Add later as `"blocked": [[x,y]]` if puzzles turn out too open.

## 13. Solution schema

```json
{
  "level_id": "2026-08-15",
  "placements": [
    { "type": "splitter", "pos": [3, 3], "rotation": 90 },
    { "type": "conveyor", "pos": [1, 3], "in": "W", "out": "E" },
    { "type": "conveyor", "pos": [3, 2], "in": "S", "out": "E" }
  ]
}
```

Rotated buildings carry `rotation`. **Conveyor placements carry `in` and `out` instead of `rotation`** (§4) — a conveyor with a `rotation` field is a validation error, as is `in == out`.

A solution plus a level is sufficient to replay deterministically. **The validator in Phase 3 is this same simulator** — build it as a pure function `simulate(level, solution) → {won, ticks, cost, footprint, jammed}` with no rendering dependency, and puzzle validation costs nearly nothing later.

**Validation.** `simulate` validates before running. Any violation — a position out of bounds, two placements on one cell, a placement on a source/sink cell, a type not in `available`, a conveyor with `in == out` or with `rotation`, a rotation outside `{0, 90, 180, 270}`, a duplicate assembler pair (§3), a `level_id` mismatch — produces a structured list of validation errors and nothing is simulated. Placements are never silently dropped. `ASSUMPTION`

**Observation API.** Beneath `simulate`, the package exposes a stepping interface: build an initial world state from `(level, solution)`, advance it one tick at a time, and read a serialisable snapshot of the whole world (cells, buffers, timers, round-robin flags, counters, `tick_count`). `simulate` is just the loop. §14's per-tick assertions are written against this interface, and tests may construct seeded world states directly (cases 2 and 9). The serialised form is part of the determinism contract (case 8). `ASSUMPTION`

**`jammed`** is `true` iff the run failed **and** the world reached a fixpoint before `max_ticks`: some tick changed nothing — no item moved, no timer decremented, no emission, no delivery, no flag flip; equivalently, the serialised state minus `tick_count` is identical before and after the tick. Determinism makes a fixpoint permanent, so the sim may stop stepping early — the reported `ticks` is still `max_ticks`. A won run is never `jammed`. Per-building stall markers in the UI are derived from world state, not from this field. `ASSUMPTION`

---

## 14. Test cases the simulator must pass

Write these as unit tests before building any UI. If the sim is wrong you will not be able to tell a render bug from a logic bug.

Tests assert through the §13 stepping/snapshot API. Fixtures that need pre-filled belts or states unreachable from an empty start (cases 2 and 9) construct seeded world states with the test API rather than mutating a running sim.

1. **Straight line.** Source → 3 conveyors → sink. Under this spec's defaults the item lands on the last conveyor in phase 3 of tick 3, is pulled into the sink buffer in phase 4 of tick 3, and is counted in phase 1 of tick 4: assert `delivered` first reaches 1 at **tick 4**. If any §15 row is overridden, re-derive by hand before implementing. Companion fixture: the level-001 reference solution delivers its first widget at **tick 12** and wins (5th widget) at **tick 28** — see `docs/level-001.md` for the derivation.
2. **Train movement.** Seed a 6-conveyor straight path with items in cells 1–5 and cell 6 empty. Step once: all five items advance in that *same* tick, not one per tick. This is the tail-first resolution test and it is the one that catches a broken tick order.
3. **Back-pressure.** Block the output. Items stack backwards to the source. The source stops emitting. Nothing is destroyed. Total item count is conserved.
4. **Splitter alternation.** Source → conveyor → splitter at rotation 0, each output feeding a connected run of three or more conveyors — long enough that nothing back-pressures during the test. Feed 6 items through: the splitter's push sequence is exactly `N, E, N, E, N, E` (`next` starts at index 0 = N), 3 items down each branch. Assert the sequence via per-tick snapshots, not just the totals.
5. **Splitter with one output blocked.** Same fixture, `E` branch blocked (no building there). All 6 items exit `N`. `next` flips on **every** successful push — including fallback successes — so after the 6th item `next == 0` again. Assert the final flag value; that is what "does not desync" means.
6. **Machine stall.** Block a press's output. It completes its job, holds the product, refuses new input, and its input buffer fills. On unblocking, it resumes without losing anything.
7. **Assembler deadlock.** Feed an assembler two items that each pass the §8 filter but form no recipe pair (e.g. two discs when the only recipe is `["disc","plate"]`). Both buffers fill and the machine deadlocks permanently: assert `jammed == true`, no crash, no item loss. Also assert the other jam shape: an item in **no** recipe never enters at all — it jams on the belt with the machine's buffers empty.
8. **Determinism.** Run the same level and solution 100 times. Byte-identical result every time, including the tick number and all three scores.
9. **Cyclic belt.** Seeded via the test API — a closed loop cannot be fed in normal play (§7). A loop with one empty cell rotates one step per tick. A fully saturated loop does not move and does not crash.
10. **Loss conservation.** Across every test in this section, at the end of every tick: `emitted + produced == in_world + delivered_total + consumed`, where `emitted` counts source emissions, `produced` counts items placed into output buffers by phase 5, `consumed` counts items removed from input buffers at job start in phase 6, `delivered_total` sums phase-1 consumptions across **all** types, and `in_world` counts items on conveyor cells plus every input, output, and sink buffer. Items inside a running job are already counted in `consumed` and are **not** in `in_world`; splitter/merger transfers touch no term. Assert as a debug invariant — it catches almost every movement bug immediately.
11. **Merger alternation.** Keep both merger inputs saturated: the merged stream alternates `W, N, W, N, …` starting at `W` (input index 0). Mirror of case 4 — this is the test that catches the phase-4/§9 interaction.
12. **Merger starvation.** Feed only one merger input: throughput is one item per tick with no stall, and `next` still flips on every transfer. Mirror of case 5.

---

## 15. Decisions to confirm before building

**Confirmed 1 Aug 2026 — all defaults accepted, no overrides.** This closes the Phase 0 spec-lock gate: no unanswered `ASSUMPTION` remains. Changing any row after this point means re-deriving the tick numbers recorded in §14 case 1 and `docs/level-001.md`, and updating the affected tests in the same commit.

| # | Decision | Default | Override? |
|---|---|---|---|
| 1 | Grid size | 7 × 7 | Accepted |
| 2 | Back-pressure | Items wait, never destroyed | Accepted |
| 3 | Machine duration | 2 ticks, per-type `durations` field in level file | Accepted |
| 4 | Palette | 5 buildings | Accepted |
| 5 | Target count | 5 items | Accepted |
| 6 | Par metric | `cost` (v0.1 said `parts` — that was an error; §11 is authoritative) | Accepted |
| 7 | Item model | Recipe tables in level file | Accepted |
| 8 | Blocked cells | Not in v1 | Accepted |
| 9 | `max_ticks` | 300 | Accepted |
| 10 | "Machine" definition | Splitter, merger, press, assembler (§4) | Accepted |
| 11 | Splitter/merger transit | 1 tick inside; transfer runs in phase 6 (§6) | Accepted |
| 12 | Sink model | Capacity-1 input buffer; counted next phase 1 (§5, §6) | Accepted |
| 13 | Source targets | May feed conveyors, machine buffers, and sinks (§6 phase 8) | Accepted |
| 14 | Round-robin `next` | Ports indexed as listed in §4; starts and resets to 0 (§9) | Accepted |
| 15 | Within-phase order | Ascending `(y, x)`, single pass (§6; no observable effect) | Accepted |
| 16 | Tick numbering | First executed tick is 1; win checked before fail (§6, §10) | Accepted |
| 17 | Conservation ledger | Gross: `emitted + produced == in_world + delivered + consumed` (§14) | Accepted |
| 18 | Input filters | Apply on pull, push, and emit; assembler check item-level, inputs-only; splitter/merger/sink accept every type (§8) | Accepted |
| 19 | `jammed` / fail values | Failed + fixpoint; `ticks = max_ticks` on fail (§11, §13) | Accepted |
| 20 | Invalid input | Structured validation errors, nothing simulated, no silent drops (§13) | Accepted |
| 21 | Observation API | Stepping + serialisable snapshot beneath `simulate` (§13) | Accepted |
| 22 | Buffer model | Capacity-1 input buffers everywhere incl. sink; one shared capacity-1 output buffer per machine (§5) | Accepted |
| 23 | Belt paths | Maximal conveyor chains; tail waits for phase-4 pull; cyclic rule and path ordering as in §7 | Accepted |
