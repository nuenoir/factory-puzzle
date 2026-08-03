# Generating factory puzzles, and knowing when you haven't

*An engineering note on the puzzle generator behind [Factory Puzzle](https://nuenoir.github.io/factory-puzzle/). Draft.*

I built a small daily puzzle game — route items across a hex grid, through presses and assemblers, into a sink, scored against par like golf — and then a generator that invents new puzzles and a validator that decides which are worth playing.

The generator is the interesting part, and not for the reason I expected.

## One function, two jobs

The simulator is a pure function of a level and a solution. No React, no canvas, no randomness, no clock. That constraint was written down before any code existed, and it is the single decision the rest of the project rests on:

```ts
simulate(level, solution) => { won, ticks, cost, footprint, jammed, errors }
```

Because it has no rendering imports, the same function that runs the game in the browser is the one that validates ten thousand generated candidates headlessly. There is no second implementation to drift. When the validator says a puzzle is solvable, it means *this exact engine* played it and won.

## The spec came first, and it paid

Before writing the simulator I wrote its rules down — tick order, belt resolution, back-pressure, what a jam is — precisely enough that two people implementing from it independently would agree on every test case. Then I hand-simulated the reference puzzle on paper and recorded the answer: first item delivered on tick 12, puzzle solved on tick 28.

Those numbers existed before the code did. When the simulator reproduced them exactly, that was meaningful evidence, in a way that a test written afterwards never is — a test written after the fact only proves the code agrees with itself.

The discipline caught real errors. Writing the spec surfaced about fifteen places where the rules were genuinely ambiguous. Implementing it surfaced two more: a machine that finished a job but couldn't hand it off kept counting its timer down forever, so a permanently stuck factory never registered as stuck; and the belt resolver for closed loops moved one item two cells per tick. Both were fixed in the spec first, then the code.

## Three stages, cheapest first

The validator answers four questions: is it solvable, is it non-trivial, does it fit a budget, and does it have more than one genuinely different solution. It does that in three stages, ordered by cost.

**Stage A** ignores the grid entirely and closes over the recipe tables from the sources. If the target item can't be reached, no arrangement of belts could ever help.

**Stage B** derives the minimum set of machines needed and therefore a lower bound on cost. If that bound already blows the budget, nothing needs placing.

**Stage C** is the expensive one: enumerate *plans* (which machines, what feeds what), place them, route belts with a breadth-first search, and simulate. The router only finds lanes; whether the factory actually delivers is the simulator's call.

Across fifty candidates, stage A settled six of them in **1 millisecond total**. The whole batch — fifty puzzles, sixteen and a half thousand placement attempts — took **738ms**. Ordering the checks by cost is most of why.

## What the validator is allowed to claim

This is the part I'd defend hardest in review.

Stage A and B rejections are *proofs*. Stage C is a bounded random search, so when it finds nothing that means only "no solution within the search we allowed." Those are completely different statements, and merging them into one "unsolvable" count would overstate what the tool knows.

So they never share a rejection code. Every log line records which stage decided, and whether the search exhausted its allowance or hit a cap:

```json
{"id":"gen-11","reason":"over_budget","stage":"C","cheapest_cost":33,"floor_cost":18,
 "bound":{"attemptsPerPlan":250,"plansTried":2,"attempts":500,"exhausted":true},
 "tally":{"routing":498,"simulation":0,"won":2}}
```

That one found two working factories out of five hundred tries, the cheaper costing 33 against a budget of 30, and it finished its search rather than running out of time. Everything needed to argue with the verdict is on the line.

The summary labels every row `proven` or `bounded`. A reader should never have to guess which kind of claim they're looking at.

## "More than one solution" needs a definition

The most interesting acceptance criterion is that a puzzle should have more than one *materially different* solution. That's easy to say and easy to fake — every puzzle has thousands of solutions if you count moving a belt one cell sideways.

So a solution's identity is its **machine multiset plus its item-flow graph**, with positions, belt geometry, and rotations all discarded. The hand-designed reference puzzle is the worked example: pressing then splitting costs 16, splitting then pressing costs 21, and those are different ideas. The same layout with a wigglier belt is not.

Without that definition the criterion measures nothing at all.

## The numbers

Fifty candidates, one seed, fully reproducible:

| Outcome | Count | Claim |
|---|---:|---|
| accepted | 3 | — |
| `no_solution_found` | 22 | bounded |
| `single_solution` | 15 | bounded |
| `unsolvable_chemistry` | 6 | **proven** |
| `over_budget` | 4 | bounded |

None of the searches were cut short — every stage-C verdict ran its full allowance. Accepted puzzles came out at par 23, 24 and 26.

## What surprised me

**Twice, a bug looked like bad luck.** Early on, every single placement attempt failed to route — 1000 out of 1000. A random search failing 100% of the time isn't unlucky, it's broken. The cause was that I paired the splitter's two outputs to the assembler's two inputs in index order, which made the two belt runs cross. A hex grid has no crossings, so nothing could ever route. The real solution uses the opposite pairing.

Fixing that exposed a second one: one plan had a single source feeding two presses, which is physically impossible — a source has one output port. The planner had been emitting layouts no grid could realise and pricing them at 18. Adding the required splitter brought the cost to 21, which is exactly what the design doc had said all along. The planner had been quietly disagreeing with the spec and the spec was right.

**The obvious optimisation made things worse.** With the search now the bottleneck, I tried sampling runner-up machine rotations instead of always taking the best-aligned one, on the theory that a deterministic heuristic fails identically on every restart. It pushed `no_solution_found` from 23 to 29. Attempts spent on worse orientations are attempts not spent on fresh placements. Reverted — and recorded, because a negative result is the evidence against the next person's obvious idea.

**Every layout that routed, won.** Of 16,500 attempts, 833 produced a complete factory and *all 833* of them delivered. Not one routed successfully and then failed to run. The planner and router produce correct factories whenever they produce anything; the entire bottleneck is geometric, not logical.

## Limitations, plainly

The search is bounded and nowhere near exhaustive. It finds *a* solution often enough to judge a level — about 5% of attempts succeed — and its silence is never evidence of impossibility.

The 6% acceptance rate is low. A daily puzzle stream would need either bigger batches or a better placement heuristic; the log says where to push, since 44% of candidates now fail in placement rather than chemistry.

All three accepted puzzles share the same shape — an assembler consuming two of one item — because that's the only structure the generator currently has for creating a real choice. Criterion 4 is faithfully selecting for it, which is both reassuring and a ceiling.

And one refinement I'd make next: of the 22 `no_solution_found` rejections, 5 had no buildable plan at all while 17 had plans that never placed. Those are different diagnoses sharing one code. The data distinguishes them, the label doesn't.

## Try it

The game is at **[nuenoir.github.io/factory-puzzle](https://nuenoir.github.io/factory-puzzle/)**. Source at **[github.com/nuenoir/factory-puzzle](https://github.com/nuenoir/factory-puzzle)**, including [the rules spec](rules-spec.md), [the generation spec](generation-spec.md), and [the tick-by-tick derivation](level-001.md) that the simulator had to match.

129 tests. The suite is mutation-tested — an earlier version passed against a simulator whose round-robin flag never flipped, because it asserted on item counts rather than watching the mechanic. A green suite is not automatically a correct one.
