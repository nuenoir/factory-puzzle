# Generation and Validation — Spec v0.6

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

| `target` | any type the recipes mention | Deliberately *not* pre-checked for reachability. |
| `available` | subset | Always includes `conveyor`. |
| `max_ticks` | 300 | Fixed. `ASSUMPTION` |

**Two routes to the target, sometimes.** The second assembler pair was allowed here from the beginning and went unemitted for months, which quietly capped what the generator could produce: with one recipe the *only* structure able to satisfy criterion 4 is an `x + x` pair plus a splitter, so every accepted puzzle was press-then-split versus split-then-press with the item names changed. It now sometimes offers a second way to reach the target — the other pairing when there are two sources, and otherwise a second way to reach the item the assembler consumes.

**Converging chains** are the other half, and they needed no format change at all. `recipes.press` is keyed by input, so `press[ore] = plate` alongside `press[scrap] = plate` has always been expressible — two chains arriving at the same item. The generator simply never wrote it. It now sometimes routes the second source's chain into the item the first one makes, which hands the assembler a route with **no splitter in it at all** (one chain per port) beside the split-one-chain routes. Those have different machine multisets, so they are different ideas rather than mirrors of each other.

That last case is deliberately *upstream* of the target rather than a shortcut to it. A press straight to the target was the first attempt and it works, in the sense that acceptance rose further; it also means the target no longer needs a fan-out, and `insufficient_fanout` fell from 24 rejections in 200 to 6. Hollowing out a proven rejection class to raise the acceptance rate is the wrong trade, and the shortcut's "choice" was fake anyway — pressing costs 5 against 11 to assemble, so one route dominates and nothing is really being decided.

**The generator does not pre-filter.** It proposes; the validator disposes. Screening candidates for reachability before submitting them would make stage A dead code and hollow out the rejection log — the breakdown is only interesting if the generator is genuinely allowed to be wrong. `ASSUMPTION`

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

### Stage B — fan-out feasibility *(microseconds, exact)*

Stage A closes over the recipe tables and asks only whether the target *type* is reachable. That ignores how many items a building can hand out at once, and the difference is not academic: an assembler recipe `disc + disc -> widget` needs two discs at two ports simultaneously, and **every building in §4 of the rules spec has exactly one output port except the splitter**.

So without a splitter a derivation must be a strict tree, and each leaf of that tree must be a *distinct source* — one source has one output port and cannot supply two chains. A level whose only route to the target needs the same source twice is **provably unsolvable**, no matter how the grid is filled.

The check: enumerate the multisets of source indices that some derivation of the target can bottom out at, and ask whether any of them is repeat-free. If none is, and `splitter` is not in `available`, reject. When a splitter *is* available the check is skipped — a chain of splitters can supply any fan-out a plan asks for.

This is exact in the same sense stage A is, and it closes a real gap. Five of the first fifty candidates are rejected here; every one of them is an `x + x -> target` assembler recipe on a level with no splitter, and previously all five were filed under the *bounded* stage-C code, which understated what the validator could actually prove. Erring toward the weaker claim is the safe direction to err, but it is still wrong.

### What the planner deliberately cannot express: the merger

A plan node is a source, a press, an assembler, a splitter or a sink. There is no merger, even though the palette offers one on roughly half the generated levels and the simulator implements it in full (rules-spec §9, and §14 cases 11 and 12 test it). That looks like an oversight and is not one.

A merger adds a building and removes none, so it can only earn its three-point cost through **throughput**, by joining two streams into one. Throughput never binds here: the target is 5 items against a `max_ticks` of 300, and a single press at one item every two ticks clears that with two orders of magnitude in hand. So for any winning solution containing a merger there is a cheaper winning one without it, obtained by deleting the merger and one of its input chains.

Measured rather than argued. On a two-source level where both belt straight to the sink, the merger layout wins — it is a real factory, not a broken one — and costs **8 against 3**, delivering in **9 ticks against 8**. Dominated on both axes the game scores. There is a test that constructs both and asserts exactly that, so the reasoning cannot rot silently.

Planning mergers would therefore contribute only *dominated* plans. They could never become `par`, and their only effect would be to inflate `distinctForms` with factories nobody would build — which is the failure §5's renaming clause was just hardened against, arriving from a different direction. Criterion 4 is supposed to count ideas, not decorations.

Two honest consequences follow, and neither is hidden:

- **`merger` in a level's `available` list has no effect on any verdict.** A level offering one is judged identically to a level that does not; a test asserts the two enumerate the same plans. It is left in the palette because the simulator supports it and a player may still place one — they will simply come in over par, which is the game working as intended.
- **One case sits outside the argument.** A merger has no input filter, so a hand-built solution could merge two *different* item types onto a shared belt run to save conveyors, and if it saved more than three cost it would beat the merger-free version. The planner models one item type per node and cannot express that at all. So the claim above is "no merger appears in a cheapest plan the planner can represent", which is weaker than "no merger appears in a cheapest solution". Stated rather than glossed, because that is the difference between a bound and a proof.

### Stage C — placement and routing *(bounded, inexact)*

Search over *plans* rather than over cells. A plan is a small dataflow graph — which machines exist and what feeds what — derived from the recipe DAG. For each plan:

1. Assign each machine a cell and rotation.
2. Route belts between connected ports with a breadth-first search over free cells.
3. **Simulate.** The router is a heuristic; `simulate` is the oracle. A layout counts as a solution only when the simulator says it wins.

Never trust the router. If routing and simulation disagree, the simulator is right by definition (CLAUDE.md).

Two things the enumerator must fix before a plan is buildable, both of them splitters. Independent chains drawing on one source produce two *copies* of it, but the level has one, at one cell. And once merged, a node may feed more consumer ports than it has outputs. This is not bookkeeping: it is why level 001's second route costs 21 rather than 18, because split-then-press has to buy its splitter too. A lone source with no splitter available cannot supply an assembler at all, and the level is then genuinely unsolvable.

### Observed behaviour

Random restarts are cheap but wasteful. On level 001, roughly **1.5% of attempts** produce a winning layout; almost every failure is a routing failure, where the machines landed somewhere the belts could not connect. Both plans are found comfortably within the default allowance.

**Fifty candidates from seed 1**, after the generator was taught to build recipe chains forward from its sources:

| Outcome | Count | Claim |
|---|---|---|
| accepted | 7 | — |
| `single_solution` | 15 | bounded |
| `over_budget` | 10 | bounded |
| `no_placement_found` | 7 | bounded (attempt cap) |
| `unsolvable_chemistry` | 6 | **proven** |
| `insufficient_fanout` | 5 | **proven** |
| `no_plan_within_depth` | 0 | bounded (plan caps) |

Of 65,000 attempts, 62,672 (96.4%) died at routing and 2,328 (3.6%) won; **not one** failed at placement, at port geometry, or at simulation. Those three zeroes have held across every batch, and they say the failures are geometric — machines landing where belts cannot reach them — rather than logical.

`single_solution` is the largest rejection class, having overtaken `no_placement_found` once the search stopped being the limit. That is the change of regime the generator work responds to: the constraint is no longer mostly "cannot find a layout" but "this puzzle has one idea in it".

Read the acceptance count with care, and prefer the shape count to it. Over 200 candidates the generator change is 31 → 42 accepted and **2 → 8 distinct machine shapes**, with the most common shape's share falling from 30-of-31 to 12-of-42. Fifty candidates cannot resolve the acceptance difference; they can show the variety, since these seven span several shapes where the previous seven were all one.

`no_plan_within_depth` scoring zero is worth recording rather than hiding: every candidate whose enumerator came up empty turned out to be provably fan-out-infeasible, so the planner's depth cap was never the binding constraint on this batch. The code stays, because that is a fact about these fifty candidates and not a guarantee about the next fifty.

Eleven of the fifty rejections are now proofs rather than bounded searches, against six before the fan-out check existed. Nothing about which candidates are accepted changed — the same five were already rejected — but the validator can now say *why* about nearly twice as many of them.

Two tuning changes were measured against this batch. Varying the order belts are routed in helped: accepted 2 → 3, candidates finding no solution 23 → 22. Sampling runner-up rotations instead of always taking the best-aligned one **hurt**, pushing that count from 23 to 29, because attempts spent on worse orientations are attempts not spent on fresh placements. It was reverted. Recording the negative result matters as much as the positive one: it is the evidence against the obvious next idea.

(Both numbers predate the code split, when a single `no_solution_found` covered what is now `insufficient_fanout`, `no_plan_within_depth` and `no_placement_found`. The five fan-out candidates were in every one of those counts and never reached the search, so the deltas the measurements report are unaffected.)

### Retrying the wiring rather than the placement

The third tuning change, and the first one measured properly enough to trust.

Since 95% of attempts die at routing, every one of those discards a placement that was *fine* — the machines were down, and one belt run could not find a lane. `routeRetries` re-pairs the ports and re-orders the belt runs on the same cells before giving up on them. Wiring is far cheaper to redo than finding somewhere new to put a factory.

Fifty candidates is too small a sample to settle a change that moves acceptance by two or three, and varying a search parameter reshuffles the whole PRNG stream, so an arm can look better for no reason. Measured instead over **200 candidates across four independent seed ranges**, paired by range:

| accepted / 50 | R=1 | R=2 | R=4 |
|---|---:|---:|---:|
| seeds 1–50 | 3 | 5 | 6 |
| seeds 101–150 | 4 | 7 | 6 |
| seeds 201–250 | 3 | 5 | 4 |
| seeds 301–350 | 0 | 6 | 7 |
| **total** | **10** | **23** | **23** |

R=2 wins in all four ranges. R=4 ties it on acceptance and costs 40% more wall clock, so the default is **2**.

The gain is not where you would guess, and this is the part worth keeping:

| across 200 candidates | R=1 | R=2 |
|---|---:|---:|
| winning attempts | 6891 | 7173 (+4%) |
| levels with ≥1 solution | 105 | 110 (+5%) |
| levels with ≥2 distinct forms | 10 | 23 (**+130%**) |

Retrying barely wins more often. It wins on the **second** plan — the machine-dense one, which needs more belt runs through a grid that is already fuller, and is therefore precisely the layout that placement restarts alone almost never wire. Criterion 4 needs two materially different solutions, so acceptance was being gated not by whether a puzzle *has* two ideas but by whether the router could ever realise the harder one.

It also tightened `par`, which matters more than the acceptance rate does. Par is the cheapest solution *found* (§2), so a weak search ships a generous one: `gen-1` went from 26 to **21** and `gen-20` from 24 to 23 on the same levels. The old numbers were beatable without trying. A better search does not just accept more puzzles, it scores the ones it accepts more honestly.

### Rip-up and re-route — measured, and rejected

The obvious next step after that, and it does not work. Recorded here because a negative result is the evidence against the next person's obvious idea, and this one is *more* useful than the change that succeeded.

Where `routeRetries` reshuffles the belt order and hopes, rip-up uses the failure: the run that could not find a lane is torn out along with everything else and promoted to route **first** next time, forcing the runs that walled it in to find their own way around. The bound is structural rather than a tuning knob — a run is promoted at most once, so the work cannot exceed one pass per belt run. It was implemented behind a switch, verified neutral when off, and measured with the same paired protocol over 200 candidates.

| accepted / 200 | R=1 | R=2 | R=4 |
|---|---:|---:|---:|
| plain | 10 | **23** | 23 |
| with rip-up | 11 | 22 | 25 |

Against the R=2 default it is a *regression* — 23 to 22, one seed range worse and three tied — for 20% more wall clock. R=4 with rip-up reaches 25, but that is two more candidates out of 200 for nearly double the clock, and paired it is two wins, one loss and one tie. Nothing here is worth the code, so the implementation was reverted.

**Why it fails is the useful part**, and it is one row of the table:

| across 200 candidates | R=1 | R=1 + rip-up | R=2 | R=2 + rip-up |
|---|---:|---:|---:|---:|
| routing failures | 52,359 | 52,289 | 52,077 | 52,001 |

A 0.7% change. If belt runs were walling each other in, promoting the blocked run would have cut that number hard; it barely moves. So the routing failures are **not ordering conflicts at all** — they are bad placements that only reveal themselves at routing time, and no ordering rescues a machine boxed into a corner.

This corrects the reading of the tally in the observed-behaviour section above. "94.8% of attempts die at routing" invites the conclusion that the router is the weak component. It is not: the router is close to optimal given where the machines are, and *placement* is the thing to improve. The tally records the stage at which an attempt was abandoned, which is not the same as the stage that caused it — a distinction worth keeping in mind before optimising anything else on the strength of that column.

It also suggests why `routeRetries` worked despite the same diagnosis, though this part is inference from the code rather than something measured. A retry calls `shufflePortPairing` again and the machine rotations are derived from the pairing, so a retry can change the *geometry* — which ports face where — and not merely the order runs are laid in. Rip-up changes the order alone, within a single pairing. If that is the whole story then the gain belongs to the re-pairing and the reshuffle is incidental, but separating the two would take another paired run and has not been done.

### Placing machines where belts can reach them

The change the rip-up result pointed at, and it works.

Placement used to take the first free cell the jitter landed on. That happily wedges a machine into a corner with one free neighbour, which cannot be wired however it is rotated. Now each machine considers up to `placementSamples` free cells and takes the one with the most free neighbours — a crude proxy, deliberately so, since rotations are not chosen until later and all that is really knowable at placement time is whether anything can get in at all.

Two details carry the result.

**Restarts alternate.** Sampling for room spreads machines out, and spread-out machines need longer belt runs, which cost more — so a search that *only* samples for room stops finding the cheap compact layouts and `par` drifts upward with them. Measured: pure roomy sampling took acceptance from 23 to 31 while making par looser on 39 levels against 14 tighter. Acceptance and par honesty moved in opposite directions, and par is the number the player is scored against. Even-numbered restarts now take the first free cell and odd ones sample, so both regimes stay in reach.

**The roomy half is an addition, not a reallocation.** Splitting the existing 250 restarts into 125 of each kept par honest but bought only two more acceptances. `attemptsPerPlan` therefore rises to 500 — 250 tight plus 250 roomy — so the compact search keeps the budget it always had.

That last decision needs a control, because it changes two things at once. All four arms over 200 candidates in four paired seed ranges:

| | accepted /200 | mean par excess | levels off best | ms |
|---|---:|---:|---:|---:|
| 250 tight *(before)* | 23 | 0.953 | 31 | 4711 |
| 500 tight *(budget control)* | 20 | 0.500 | 16 | 9187 |
| 125 tight + 125 roomy | 25 | 0.877 | 42 | 5807 |
| **250 tight + 250 roomy** | **31** | **0.406** | 23 | 11554 |

*Par excess* is how far an arm's reported par sits above the cheapest cost any arm found for that level, over the levels every arm solved. Lower is a tighter, more honest par.

Against the control — same 500-restart budget, heuristic off — the heuristic takes acceptance from 20 to 31 and par excess from 0.500 to 0.406. It wins on both axes with the budget held constant, which is the comparison that licenses the change.

**The control also shows how noisy acceptance is.** Doubling the budget on its own moved it *down*, 23 to 20, because a changed restart count reshuffles the entire PRNG stream. Swings of ±3 mean nothing. This is the third search change in a row where the single canonical batch would have given the wrong answer, and it is why every one of them is measured across four ranges paired.

### More than one kind of puzzle

With the search no longer the limit, `single_solution` became the largest rejection class — and that is a statement about the generator, not the search. §2 now sometimes offers a second route to the target.

**Acceptance is the wrong headline for this one.** It moved 31 → 36 over 200 candidates, which is barely outside the noise band established above. What actually changed is the *shape* of what gets accepted:

| accepted levels, 200 candidates | one route | alternative routes |
|---|---:|---:|
| accepted | 31 | 42 |
| **distinct machine shapes among them** | **2** | **8** |
| most common shape's share | 30 of 31 | 12 of 42 |
| candidates reaching 3+ distinct forms | 0 | 17 |
| `single_solution` | 82 | 71 |
| plans enumerated | 237 | 461 |

Thirty of thirty-one accepted levels used to be the same puzzle with the item names changed. New shapes include factories with three assemblers and three splitters, and — from the converging chains — levels with **no assembler at all**, where the choice is one press against two. The old generator could express neither.

Note the knock-on costs, none of them hidden. Richer chemistry means more plans to place (attempts 33,000 → 65,000) and a lower win rate per attempt (6.9% → 3.6%), because the extra plans are the hard ones. `over_budget` rose from 8 to 10 on the canonical batch: more machines, more cost, and some of the new routes genuinely do not fit in 30. Those are honest rejections of real levels, not a regression. `insufficient_fanout` fell from 24 to 14 over 200 candidates, which is the real cost of the change — a level with a two-arm route no longer needs a splitter, so fewer levels are fan-out-infeasible. Fewer such levels exist; the check still fires on every one that does.

One of the new shapes lands close to the floor: `gen-43` comes out at par 9 against a `min_cost` of 8. It clears every criterion and it is a very small puzzle. Whether the floor should rise is a §8 question, not a generator one.

All three accepted levels share the same shape — an assembler consuming two of one item — because that is what creates the press-then-split versus split-then-press choice. Criterion 4 is therefore selecting for level 001's structure, which is reassuring and also a limitation: the generator currently has one way of making a puzzle interesting.

The honest summary is that this search finds *a* solution often enough to judge a level, and is nowhere near exhaustive. Every claim it makes is scoped accordingly.

### The bound, and what it lets us say

Stage C is bounded by two plan caps, a placement cap, a wiring-retry cap, and a wall-clock timeout, all recorded per candidate. This matters for honesty:

- Stage A rejecting means **provably unsolvable** — no arrangement of anything could help. Code: `unsolvable_chemistry`.
- Stage B rejecting means **provably unsolvable** too, for a different reason: either the cheapest conceivable machine set already blows the budget (`over_budget_floor`), or the target needs a fan-out the level has no splitter for (`insufficient_fanout`).
- Stage C finding nothing means **no solution found within the bound**, which is not a proof of anything.

These are different claims and must never share a code. The write-up can say "N candidates were provably unsolvable" only about the first two. Conflating them would overstate what the validator knows, which is precisely the kind of thing a reader who knows search would catch.

**"No solution found" is itself two different bounds**, and they too get separate codes. A stage-C search can come up empty because the plan enumerator never produced anything to place, or because plans existed and no placement of them worked:

- `no_plan_within_depth` — the enumerator returned no buildable plan within `maxDepth` and `maxPlans`. Bounded by the *plan* caps. Nothing was ever placed, so the attempt tally is empty and the placement search says nothing about this candidate.
- `no_placement_found` — plans existed, and `attemptsPerPlan` restarts of each failed to produce a layout the simulator would pass. Bounded by the *attempt* cap.

The two have different fixes — a deeper enumerator versus a better placement heuristic — so a log that cannot tell them apart cannot tell you where to push. Both plan caps are therefore recorded in `bound` alongside the attempt caps, so either verdict can be argued with from the log line alone.

Note the asymmetry: `insufficient_fanout` and `no_plan_within_depth` can look similar from outside — both mean "the enumerator had nothing" — but one is a proof about ports and the other is an admission about search depth. Getting that boundary right is the whole reason stage B exists as a separate stage.

---

## 5. "Materially different solutions"

The interesting criterion, and the one nobody else will have thought to measure. It needs a definition that is not trivially satisfied.

**Two solutions are materially different if their canonical form differs.** The canonical form of a solution is:

- the **multiset of non-conveyor buildings** used, plus
- the **item-flow graph** between them — which machine feeds which, labelled by item type,

with belt geometry, absolute positions, and rotations all discarded — and with **item types relabelled canonically**, so the form is invariant under renaming them.

Level 001 is the worked example. Press-then-split is `{press, splitter}` with `source → press → splitter → assembler×2`. Split-then-press is `{splitter, press×2}` with `source → splitter → press×2 → assembler`. Different multisets, so: materially different. That is the decision the level is built around, and the definition catches it.

The same layout with a wigglier belt canonicalises identically and does **not** count. Without that, every level would trivially have thousands of "solutions" and criterion 4 would measure nothing. `ASSUMPTION`

### Why the relabelling clause exists

Labelling the flow graph with concrete item types looks harmless and is not. Take a level with two sources, `ore` and `scrap`, where both press into `plate`:

| cost | machines | drawn from |
|---:|---|---|
| 16 | assembler + press + splitter | `ore` |
| 16 | assembler + press + splitter | `scrap` |
| 18 | assembler + press + press | both |
| 21 | assembler + press + press + splitter | `ore` |
| 21 | assembler + press + press + splitter | `scrap` |

Rows 1 and 2 are the same factory built from the other source, and so are 4 and 5. There are three ideas here; an item-labelled canonical form counts five. That is the failure the wigglier-belt clause was written to prevent, occurring one level up — a **mirror image is not a second idea** any more than a detour is.

Canonical renaming fixes it: compute the form under every bijective renaming of the item types the plan mentions and keep the lexicographically smallest, so two plans isomorphic up to renaming collapse to one string. Exact rather than heuristic, and cheap — a plan carries three to five types, so it is a handful of orderings, memoised per plan.

What it must **not** collapse is an assembler fed two of the same item versus one fed two different items. Renaming preserves that, because a bijection cannot turn `x + x` into `x + y`. The tests assert it directly, since it is the property this clause could plausibly break.

The flaw was latent, not active: the generator never emitted two source types reaching the same item, so no batch was ever miscounted. It was found by building the level that would trigger it *before* writing the generator that would — which is the only reason the numbers in this document never had to be withdrawn.

One side effect worth having. Forms are now comparable **across** levels, since press-then-split is the same idea whether the item is called `disc` or `plate`. The catalogue can be asked how many distinct ideas it contains in total, not just how many each level has.

---

## 6. The rejection log

One JSON object per candidate, one per line (JSONL), appended as the batch runs so a crash does not lose the record.

```json
{
  "id": "gen-42",
  "seed": 42,
  "accepted": false,
  "reason": "single_solution",
  "stage": "C",
  "elapsed_ms": 812,
  "solutions_found": 1,
  "distinct_forms": 1,
  "cheapest_cost": 14,
  "floor_cost": 8,
  "par": null,
  "bound": { "maxDepth": 4, "maxPlans": 40, "attemptsPerPlan": 250, "routeRetries": 2,
             "timeoutMs": 4000, "plansTried": 2, "attempts": 500, "exhausted": true },
  "tally": { "placement": 0, "ports": 0, "routing": 498, "simulation": 0, "won": 2 }
}
```

`bound` carries every cap the search was subject to — the two plan caps and the two attempt caps — next to what it actually consumed. `tally` counts where each attempt died, so the log says not just *that* a search failed but *where*, which is what makes it possible to tune the search on evidence rather than intuition.

`reason` is `null` on acceptance and otherwise exactly one of:

| Code | Stage | Claim strength |
|---|---|---|
| `unsolvable_chemistry` | A | **Proven** — the target type is not in the recipe closure |
| `over_budget_floor` | B | **Proven** — the machine floor alone already exceeds `max_cost` |
| `insufficient_fanout` | B | **Proven** — every route needs a fan-out and no splitter is available |
| `no_plan_within_depth` | C | **Bounded by the plan caps** — the enumerator produced nothing buildable |
| `no_placement_found` | C | **Bounded by the attempt cap** — plans existed, no layout of them won |
| `trivial` | C | Cheapest found is below `min_cost`, or uses only conveyors |
| `over_budget` | C | Cheapest found exceeds `max_cost` |
| `single_solution` | C | Fewer than two materially different solutions found |

`bound.exhausted` records whether stage C finished its search or hit a cap — the difference between "looked everywhere we allowed" and "ran out of time". Any headline number in the write-up should state how many candidates hit a cap.

The example above shows the shape the batch actually emits. An earlier draft of this section used shorter field names (`plans`, `placements`, `timeout_ms`); the code's richer shape won, and this is the deliberate spec change rather than a drift to fix.

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

**Amended 4 Aug 2026 (v0.2).** Three changes, all to what the validator is allowed to *claim* rather than to what it accepts:

| # | Decision | Choice |
|---|---|---|
| 10 | Fan-out feasibility | New exact stage-B check, code `insufficient_fanout`, **proven** (§4) |
| 11 | Splitting `no_solution_found` | Two codes by which bound was binding: `no_plan_within_depth` and `no_placement_found` (§4) |
| 12 | Plan caps in the log | `maxDepth` and `maxPlans` recorded in `bound`, so a plan-bounded verdict is arguable from the log line |

Decision 10 changes which candidates are accepted only in the sense that it moves five rejections from a bounded code to a proven one — the same five candidates were already rejected. Decisions 11 and 12 change nothing about acceptance at all. The batch was re-run after all three, per the note above.

**Amended 5 Aug 2026 (v0.3).** One change, and unlike the v0.2 batch it does move which candidates pass:

| # | Decision | Choice |
|---|---|---|
| 13 | `routeRetries` | **2** — wiring passes per placement before the placement is abandoned, recorded in `bound` (§4) |

Chosen by measurement over 200 candidates, not by argument; 1 reproduces the previous behaviour exactly and 4 was no better for 40% more clock. Accepted went 3 → 5 on the canonical batch, and two accepted levels had their par tightened, `gen-1` from 26 to 21. Re-run the batch after changing it — par is a function of how hard the search looked.

**Amended 5 Aug 2026 (v0.4).** Placement, following the rip-up finding that routing failures are really placement failures:

| # | Decision | Choice |
|---|---|---|
| 14 | `placementSamples` | **4** — consider four free cells per machine and take the one with the most free neighbours (§4) |
| 15 | Alternating restarts | Even restarts place tight, odd restarts sample for room, so `par` keeps access to compact layouts |
| 16 | `attemptsPerPlan` | **250 → 500**, so the roomy half is an addition rather than a reallocation |

Accepted went 5 → 7 on the canonical batch. Four of the five previously accepted levels kept their par exactly; `gen-49` slipped by one, from 23 to 24, which is a single-level loss against a clear aggregate gain and is recorded rather than smoothed over. Batch time 1.4s → 2.5s.

**Amended 9 Aug 2026 (v0.5).** The generator, now that it rather than the search is the limit:

| # | Decision | Choice |
|---|---|---|
| 17 | `alternativeRoutes` | **on** — sometimes offer a second recipe reaching the target, using the second assembler pair §2 always allowed, and sometimes converge the second source's chain on the first's item (§2, §4) |
| 18 | §5 canonical form | Invariant under renaming item types, so a mirror image is not counted as a second idea (§5) |

Judge 17 on shapes rather than the acceptance count: **2 → 8 distinct machine shapes** among accepted levels over 200 candidates. Acceptance moved 31 → 42, which is real but the smaller half of the story. A press straight to the target would have raised acceptance further still and was rejected for gutting `insufficient_fanout`; see §2.

Decision 18 had to land **before** 17's converging chains, because converging is exactly what makes mirror-image plans possible. It was verified a no-op on the catalogue as it stood — 0 of 50 records changed, 0 `distinct_forms` moved — so no number previously published here was ever wrong. That ordering was luck the second time and deliberate the first.
