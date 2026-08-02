# Generation and Validation — Spec v0.1

**Purpose.** Defines what the generator proposes, what the validator checks, and — most importantly — what the validator is allowed to *claim*. This document is authoritative for `packages/gen/` the way `rules-spec.md` is for `packages/sim/`.

**The deliverable is the rejection log.** The roadmap's gate is 50+ candidates run through the validator with the breakdown written up. A generator that emits good puzzles but cannot say *why* it rejected the others has produced nothing worth showing. Design the log first, not last.

Anything marked `ASSUMPTION` is a decision made on your behalf — override it in §8 before building, not after.

---

## 1. Non-goals

- **Proving optimality.** The validator finds the cheapest solution *it can*. It never claims that is the global minimum. `docs/level-001.md` already sets this precedent: par 21 is verified, not proven optimal.
- **Fun.** The validator measures structure, not enjoyment. A puzzle can pass every criterion and still be dull. Only playtesting settles that.
- **Exhaustive search.** See §4. The search is bounded on purpose, and the bound is reported.

---

## 2. What the generator proposes

A candidate is a `Level` (rules-spec §12) plus the seed that produced it. The generator owns **all** randomness in this project — `packages/sim/` has none by rule, so a candidate is reproducible from its seed alone.

Varied per candidate:

| Field | Range | Note |
|---|---|---|
| `grid` | 5×5 to 7×7 | Smaller grids search faster; see §4. |
| `sources` | 1–2 | Position on the west edge, one emitted type each. |
| `sinks` | 1 | Position on the east edge. |
| `recipes.press` | 1–3 entries | A one-to-one type map. |
| `recipes.assembler` | 0–2 pairs | Unordered; duplicates rejected at load (rules-spec §3). |
| `target` | derived | Must be a type the chemistry can actually produce (§4 stage A). |
| `available` | subset | Always includes `conveyor`. |
| `max_ticks` | 300 | Fixed. `ASSUMPTION` |

**`par` is not proposed.** It is *computed* by the validator as the cost of the cheapest solution found, and carries the same caveat as level-001: verified, not proven optimal. A generator that guessed par would be inventing the one number the level is scored against. `ASSUMPTION`

---

## 3. Acceptance criteria

A candidate is accepted only if all four hold. Each has a distinct rejection code so the log can be counted.

1. **Solvable.** The solver found at least one solution that wins under `simulate`.
2. **Non-trivial.** The cheapest solution found costs at least `min_cost` (default **8**, i.e. more than a bare belt run) **and** uses at least one non-conveyor building. Pure routing is not a puzzle. `ASSUMPTION`
3. **Within budget.** The cheapest solution found costs at most `max_cost` (default **30**). A level needing more than that will not fit a three-minute daily. `ASSUMPTION`
4. **More than one materially different solution.** See §5.

Criteria are checked cheapest-first (§4), so a candidate rejected at stage A never pays for a search.

---

## 4. The solver

The expensive part, and the one the roadmap flags as the schedule risk. It runs in stages, each able to reject before the next is paid for.

### Stage A — chemistry reachability *(microseconds, exact)*

Ignore the grid entirely. From the multiset of source types, close over the recipe tables: a press maps one type to another; an assembler maps an unordered pair to one. If the target type is not in the closure, the candidate is **provably unsolvable** — no placement could ever help.

This is exact, and it rejects most malformed candidates for almost nothing. It is what makes a 50-candidate batch cheap.

### Stage B — machine floor *(microseconds, exact lower bound)*

From the recipe DAG, derive the minimum multiset of machines needed to produce one target item, and hence a **lower bound** on cost. If that bound already exceeds `max_cost`, reject without placing anything. If it falls below `min_cost`, the candidate is *probably* trivial, but this is only a bound — confirm in stage C before rejecting as trivial.

### Stage C — placement and routing *(bounded, inexact)*

Search over *plans* rather than over cells. A plan is a small dataflow graph — which machines exist and what feeds what — derived from the recipe DAG. For each plan:

1. Assign each machine a cell and rotation.
2. Route belts between connected ports with a breadth-first search over free cells.
3. **Simulate.** The router is a heuristic; `simulate` is the oracle. A layout counts as a solution only when the simulator says it wins.

Never trust the router. If routing and simulation disagree, the simulator is right by definition (CLAUDE.md).

### The bound, and what it lets us say

Stage C is bounded by a plan cap, a placement cap, and a wall-clock timeout, all recorded per candidate. This matters for honesty:

- Stage A rejecting means **provably unsolvable**. Code: `unsolvable_chemistry`.
- Stage C finding nothing means **no solution found within the bound**. Code: `no_solution_found`.

These are different claims and must never share a code. The write-up can say "N candidates were provably unsolvable" only about the first. Conflating them would overstate what the validator knows, which is precisely the kind of thing a reader who knows search would catch.

---

## 5. "Materially different solutions"

The interesting criterion, and the one nobody else will have thought to measure. It needs a definition that is not trivially satisfied.

**Two solutions are materially different if their canonical form differs.** The canonical form of a solution is:

- the **multiset of non-conveyor buildings** used, plus
- the **item-flow graph** between them — which machine feeds which, labelled by item type,

with belt geometry, absolute positions, and rotations all discarded.

Level 001 is the worked example. Press-then-split is `{press, splitter}` with `source → press → splitter → assembler×2`. Split-then-press is `{splitter, press×2}` with `source → splitter → press×2 → assembler`. Different multisets, so: materially different. That is the decision the level is built around, and the definition catches it.

The same layout with a wigglier belt canonicalises identically and does **not** count. Without that, every level would trivially have thousands of "solutions" and criterion 4 would measure nothing. `ASSUMPTION`

---

## 6. The rejection log

One JSON object per candidate, one per line (JSONL), appended as the batch runs so a crash does not lose the record.

```json
{
  "id": "gen-0042",
  "seed": 1337,
  "accepted": false,
  "reason": "single_solution",
  "stage": "C",
  "elapsed_ms": 812,
  "solutions_found": 1,
  "cheapest_cost": 14,
  "bound": { "plans": 40, "placements": 5000, "timeout_ms": 2000, "exhausted": true }
}
```

`reason` is `null` on acceptance and otherwise exactly one of:

| Code | Stage | Claim strength |
|---|---|---|
| `unsolvable_chemistry` | A | Proven |
| `over_budget_floor` | B | Proven (lower bound already exceeds `max_cost`) |
| `no_solution_found` | C | **Bounded** — not a proof of unsolvability |
| `trivial` | C | Cheapest found is below `min_cost`, or uses only conveyors |
| `over_budget` | C | Cheapest found exceeds `max_cost` |
| `single_solution` | C | Fewer than two materially different solutions found |

`bound.exhausted` records whether stage C finished its search or hit a cap — the difference between "looked everywhere we allowed" and "ran out of time". Any headline number in the write-up should state how many candidates hit a cap.

---

## 7. Determinism

Same seed, same batch, byte-identical log — excluding `elapsed_ms`, which is wall-clock and therefore the one field that may vary. Everything else must reproduce, or the write-up's numbers cannot be checked by anyone, including you in a month.

The simulator contributes no randomness (CLAUDE.md), so this reduces to: the generator's PRNG is seeded, and the solver's search order is deterministic.

---

## 8. Decisions to confirm before building

**Confirmed 2 Aug 2026 — all defaults accepted.** Any of these can still be changed; unlike the rules spec they do not invalidate hand-derived numbers, they only change which candidates pass. Re-run the batch after changing one, and say so in the write-up.

| # | Decision | Default | Override? |
|---|---|---|---|
| 1 | Grid sizes generated | 5×5 to 7×7 | Accepted |
| 2 | `min_cost` (non-trivial floor) | 8 | Accepted |
| 3 | `max_cost` (budget ceiling) | 30 | Accepted |
| 4 | `par` | Computed, not proposed | Accepted |
| 5 | Materially different | Machine multiset + flow graph (§5) | Accepted |
| 6 | Stage C bound | Plan/placement caps + timeout, all logged | Accepted |
| 7 | Proven vs bounded rejection | Separate codes, never merged (§4) | Accepted |
| 8 | Log format | JSONL, appended live | Accepted |
| 9 | `max_ticks` | 300, fixed | Accepted |
