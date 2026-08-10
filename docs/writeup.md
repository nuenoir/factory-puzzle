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

**Stage B** is two exact checks. One derives the minimum set of machines needed and therefore a lower bound on cost; if that bound already blows the budget, nothing needs placing. The other counts ports, and I'll come back to it because it's the one I didn't expect to need.

**Stage C** is the expensive one: enumerate *plans* (which machines, what feeds what), place them, route belts with a breadth-first search, and simulate. The router only finds lanes; whether the factory actually delivers is the simulator's call.

Across fifty candidates, stages A and B settle ten of them in **under a millisecond between them**. The whole batch — fifty puzzles, sixty-five thousand placement attempts — takes about **four seconds**. Ordering the checks by cost is most of why.

## What the validator is allowed to claim

This is the part I'd defend hardest in review.

Stage A and B rejections are *proofs*. Stage C is a bounded random search, so when it finds nothing that means only "no solution within the search we allowed." Those are completely different statements, and merging them into one "unsolvable" count would overstate what the tool knows.

So they never share a rejection code. Every log line records which stage decided, every cap the search was subject to, and whether it exhausted its allowance or hit one:

```json
{"id":"gen-11","reason":"over_budget","stage":"C","cheapest_cost":33,"floor_cost":18,
 "bound":{"maxDepth":4,"maxPlans":40,"attemptsPerPlan":250,"timeoutMs":4000,
          "plansTried":2,"attempts":500,"exhausted":true},
 "tally":{"placement":0,"ports":0,"routing":498,"simulation":0,"won":2}}
```

That one found two working factories out of five hundred tries, the cheaper costing 33 against a budget of 30, and it finished its search rather than running out of time. Everything needed to argue with the verdict is on the line.

The summary labels every row `proven` or `bounded`. A reader should never have to guess which kind of claim they're looking at.

### "No solution found" was hiding two different admissions

The first version of this had one bounded code for an empty search. That's not enough, because a search can come up empty two ways: the plan enumerator never produced anything to place, or plans existed and no placement of them worked. Those have different fixes — a deeper enumerator versus a better placement heuristic — so a log that can't tell them apart can't tell you where to push.

They're now `no_plan_within_depth` and `no_placement_found`, bounded by the plan caps and the attempt cap respectively, with both sets of caps on every log line.

The interesting part is what happened when I actually split them. Of the 22 candidates that had been filed as "no solution found", 5 had no plan at all. All five turned out to be the same thing, and it wasn't a search problem.

## Counting ports, not just chemistry

Every one of those five was an assembler recipe of the form `x + x -> target` on a level with no splitter in its palette.

Stage A said those levels were fine. It closes over the recipe tables and asks whether the target *type* is reachable, and it is: you can press your way to `x`, and `x + x` makes the target. What that question can't see is that the assembler needs two `x` at two input ports *at the same time*, and every building in the game has exactly one output port except the splitter. One source, one port, one consumer. With no splitter there is no way to feed both arms, and no arrangement of belts on any grid of any size will change that.

So these levels were not "no solution found within our search". They were **impossible**, provably, and the validator had been reporting them as the weaker claim. That's erring in the safe direction — understating rather than overstating — but it's still wrong, and it was costing a full 250-attempt search per candidate to say nothing.

The check that catches it is small. Without a splitter every building feeds exactly one consumer, so the factory has to be a strict tree — which means the question is just: is there a derivation of the target whose leaves are *distinct* sources? Track the set of sources each arm consumes as a bitmask, and let an assembler combine two arms only when their masks don't overlap, because an overlap means one source would have to feed both. If nothing survives, reject, and call it proven.

Two things I had to be careful about.

**It must not be depth-bounded.** My first version reused the planner's depth limit of 4, which would have turned "I didn't look far enough" into "impossible" — the exact conflation this whole scheme exists to prevent. The enumeration now has no depth limit at all. It terminates because it won't revisit a type already on the current chain, and that truncation is sound *here* specifically: a derivation that loops back to a type it already made can be cut short at the inner occurrence, which yields a subset of the leaves, and fewer leaves only makes distinctness easier. So nothing feasible is ever hidden by the cut. There's a test that would fail if the bound came back — a level whose only fan-out-free route runs five presses deep.

**A proven code that fires on a solvable level would be the worst bug in the package**, so the false-positive direction got the attention: two sources that can each reach `x` independently, two genuinely different input types, a recipe that has both a fan-out route and a fan-out-free one. Then I ran it against all fifty candidates and checked it never fired on one the solver had actually solved.

Result: 11 of the 50 rejections are now proofs rather than bounded searches, against 6 before. Which candidates get accepted didn't change at all — the same five were already being rejected. The validator just knows why now.

The general shape of this is the bit worth keeping: **a cheap exact check can be hiding inside what looks like a search problem**, and the way I found it was by making the log distinguish two things it had been lumping together. The refinement paid for itself immediately, which is not usually how tidying up the taxonomy goes.

## "More than one solution" needs a definition

The most interesting acceptance criterion is that a puzzle should have more than one *materially different* solution. That's easy to say and easy to fake — every puzzle has thousands of solutions if you count moving a belt one cell sideways.

So a solution's identity is its **machine multiset plus its item-flow graph**, with positions, belt geometry, and rotations all discarded. The hand-designed reference puzzle is the worked example: pressing then splitting needs `{press, splitter, assembler}` for 16 in machines, splitting then pressing needs a second press for 21, and those are different ideas. The same layout with a wigglier belt is not.

Without that definition the criterion measures nothing at all.

There's a pleasing side effect. The reference puzzle's par was set by hand at 21 — 16 in machines plus five conveyors — and the design doc noted that whether the solver could beat a human was a good first test of it. It can't, and that's the answer I wanted: run the solver on that level and its cheapest verified layout comes to exactly 21, with the second idea trailing at 36. A search that had come in under par would have meant the hand-derived number was wrong; one that came in over would have meant the search was weak. Landing on it is the only outcome that confirms both.

## The numbers

Fifty candidates, one seed, fully reproducible:

| Outcome | Count | Claim |
|---|---:|---|
| accepted | 7 | — |
| `single_solution` | 15 | bounded |
| `over_budget` | 10 | bounded |
| `no_placement_found` | 7 | bounded — attempt cap |
| `unsolvable_chemistry` | 6 | **proven** |
| `insufficient_fanout` | 5 | **proven** |
| `no_plan_within_depth` | 0 | bounded — plan caps |

None of the searches were cut short — every stage-C verdict ran its full allowance. Accepted puzzles came out at par 9, 20, 23, 24, 24, 25 and 26, across several machine shapes.

That par of 9 is worth flagging rather than hiding. It's one of the new assembler-free levels — one press against two — and it clears `min_cost` of 8 by a single point. A legitimate puzzle by every criterion I wrote down, and a very small one. Whether the floor should rise is a question about the criteria rather than the generator, so I've left it and said so.

`single_solution` being the largest class is the honest summary of where this stands: the limit is no longer *"I can't find a layout"* but *"this puzzle has one idea in it"*. The generator work below moved that, and there's more of it to do.

That last row scoring zero is worth leaving in the table rather than deleting. It says the planner's depth cap was never the binding constraint on these fifty candidates: every empty enumeration turned out to be provably impossible instead. That's a fact about this batch, not a guarantee, and the code stays.

Where the 65,000 attempts went:

| Died at | Count | Share |
|---|---:|---:|
| routing | 62,672 | 96.4% |
| won | 2,328 | 3.6% |
| placement | 0 | 0.0% |
| port geometry | 0 | 0.0% |
| simulation | 0 | 0.0% |

Three of those five rows are zero, and that's the most useful thing in the table. Nothing ever failed to *place* its machines, and nothing that routed then failed to run. The bottleneck is one thing only: machines landing where belts can't reach them.

## Spending the same budget differently

That table is a suggestion, so I took it. If 95% of attempts die at routing, then 95% of the time the machines were down and *one belt run* couldn't find a lane — and the whole attempt, placement included, got thrown away. Wiring is much cheaper to redo than placement. So: re-pair the ports, re-order the belt runs, try again on the same cells before abandoning them.

I did not trust fifty candidates to settle this. Acceptance moves by two or three, and changing a search parameter reshuffles the entire random stream, so an arm can look better for no reason at all — which is exactly how the rotation experiment above fooled me into trying it. Measured over **200 candidates across four independent seed ranges**, paired:

| accepted / 50 | 1 pass | 2 passes | 4 passes |
|---|---:|---:|---:|
| seeds 1–50 | 3 | 5 | 6 |
| seeds 101–150 | 4 | 7 | 6 |
| seeds 201–250 | 3 | 5 | 4 |
| seeds 301–350 | 0 | 6 | 7 |
| **total** | **10** | **23** | **23** |

Two passes wins in all four ranges. Four ties it and costs 40% more wall clock, so two it is.

Then the interesting bit, which I'd have got wrong if I'd only looked at the headline:

| across 200 candidates | 1 pass | 2 passes |
|---|---:|---:|
| winning attempts | 6,891 | 7,173 (+4%) |
| levels with ≥1 solution | 105 | 110 (+5%) |
| levels with ≥2 distinct forms | 10 | 23 (**+130%**) |

Retrying the wiring barely wins more often. It wins on the **second** solution. The second plan is the machine-dense one — split-then-press buys an extra press — so it needs more belt runs through a grid that's already fuller, and it's precisely the layout that placement restarts alone could almost never wire. Acceptance requires two materially different solutions, so criterion 4 had been gated not by whether a puzzle *has* two ideas but by whether my router could realise the harder one. That's a measurement artefact sitting inside an acceptance criterion, and nothing about the criterion would have revealed it.

**The part I care about more than the acceptance rate.** Par is the cheapest solution *found*, which means a weak search ships a generous one. Two of the already-accepted levels had their par tightened by the same change: `gen-1` from 26 down to **21**, `gen-20` from 24 to 23. Those puzzles were shipping a par you could beat without trying, and nothing in the pipeline would have flagged it — the level was accepted, the par was verified, the number was just *loose*. A better search doesn't only accept more puzzles. It scores the ones it already accepted more honestly, and that's the failure mode I'd least like to have shipped.

## The one that didn't work, and taught me more

The obvious next step was a proper rip-up-and-reroute, the standard trick from circuit routing. Instead of reshuffling and hoping, use the failure: tear out everything and lay the run that got stuck *first*, forcing the runs that blocked it to find their own way around. Each run gets promoted at most once, so it's bounded by the number of runs rather than by a number I'd have to invent.

Same measurement protocol, 200 candidates, four seed ranges:

| accepted / 200 | 1 pass | 2 passes | 4 passes |
|---|---:|---:|---:|
| plain | 10 | **23** | 23 |
| with rip-up | 11 | 22 | 25 |

Against the shipping default it's a *regression* — 23 to 22 — for 20% more wall clock. I reverted it.

The reason is one row I nearly didn't look at:

| across 200 candidates | 1 pass | + rip-up | 2 passes | + rip-up |
|---|---:|---:|---:|---:|
| routing failures | 52,359 | 52,289 | 52,077 | 52,001 |

**0.7%.** If belt runs were blocking each other, promoting the blocked one would have cut that number hard. It doesn't move. So the routing failures aren't ordering conflicts at all — they're bad *placements* that happen to reveal themselves at routing time. No ordering rescues a machine boxed into a corner.

Which means I'd been misreading my own instrument. "94.8% of attempts die at routing" reads as *the router is the weak component*. It isn't — the router is close to optimal given where the machines are. The tally records the stage at which an attempt was **abandoned**, and that is not the stage that **caused** it. I'd been pointing at the wrong half of the pipeline for two rounds of work, and the only reason I found out is that I measured a change I expected to succeed.

That's the argument for keeping negative results, and it's stronger than the usual one. This experiment didn't just fail to help — it invalidated the reading I'd have used to justify the next three things I tried.

## Placing machines where belts can reach them

So: placement. It used to take the first free cell the jitter landed on, which happily wedges a machine into a corner with one free neighbour — unwireable however you rotate it. Now it considers four free cells and takes the one with the most free neighbours. Crude on purpose: rotations aren't chosen until later, so all that's really knowable at placement time is whether anything can get in at all.

It worked, and the row that had refused to move for rip-up finally moved — routing failures down 6.1%, against rip-up's 0.7%. Acceptance went 23 → 31 out of 200.

**And it made par worse.** Roomy placements spread machines out, spread machines need longer belts, longer belts cost more. The search was finding more solutions and losing the cheap compact ones: par looser on 39 levels, tighter on 14. I'd written two sections earlier that par honesty matters more than acceptance rate, and here was a change that bought acceptance by quietly mis-scoring puzzles.

The fix is to keep both regimes. Even-numbered restarts place tight, odd ones sample for room. But splitting the existing 250 restarts into 125 of each kept par honest and bought almost nothing — so the roomy half had to be an *addition*: 500 restarts, 250 of each, with the compact search keeping the budget it always had.

That changes two things at once, so it needs a control:

| over 200 candidates | accepted | mean par excess | ms |
|---|---:|---:|---:|
| 250 tight *(before)* | 23 | 0.953 | 4,711 |
| 500 tight *(budget control)* | 20 | 0.500 | 9,187 |
| 125 tight + 125 roomy | 25 | 0.877 | 5,807 |
| **250 tight + 250 roomy** | **31** | **0.406** | 11,554 |

*Par excess* is how far an arm's par sits above the cheapest cost any arm found, over levels all four solved. Lower is more honest.

Against the control — same budget, heuristic off — it's 20 → 31 accepted and 0.500 → 0.406 par excess. Both axes, budget held constant. That's the comparison that licenses the change; without the control I'd have credited the heuristic for gains that were really just twice the search.

**The control also shows how noisy this all is.** Doubling the budget on its own moved acceptance *down*, 23 → 20, purely because a changed restart count reshuffles the PRNG stream. Swings of ±3 are nothing. That's now three search changes in a row where the single 50-candidate batch would have told me the wrong thing.

## Every puzzle was the same puzzle

With the search no longer the bottleneck, `single_solution` became the biggest rejection class — and that's not a search problem, it's the generator admitting it only knows one joke.

I'd been writing "all accepted puzzles share the same shape" in this section for three revisions as a limitation. When I finally measured it, it was worse than I'd been saying: of 31 accepted levels across 200 candidates, **30 were the same shape** — press-then-split versus split-then-press, with the item names changed. One puzzle, thirty costumes.

The cause was a single unemitted line. The spec had always allowed two assembler recipes per level; the generator only ever wrote one. With one recipe, the *only* structure that can satisfy "two materially different solutions" is an `x + x` pair with a splitter. Every other level had exactly one plan and was rejected no matter how good the search got. Criterion 4 wasn't selecting for interesting puzzles, it was selecting for the one shape that could possibly pass.

So the generator now sometimes offers a second route to the target. And the result is the wrong number to lead with:

| accepted levels, 200 candidates | one route | two routes |
|---|---:|---:|
| accepted | 31 | 42 |
| **distinct machine shapes** | **2** | **8** |
| most common shape's share | 30 of 31 | 12 of 42 |
| candidates reaching 3+ distinct forms | 0 | 17 |
| `single_solution` rejections | 82 | 71 |

Acceptance is up by eleven, which is real. The shape count going from two to eight is the part I'd lead with. New shapes include factories with three assemblers and three splitters, and — my favourite — levels with **no assembler at all**, where the whole puzzle is whether to run one press or two. The old generator couldn't express either.

A chunk of that came free. I'd assumed the recipe format was the blocker, because `press` maps each input type to exactly one output. It does — but it's keyed by *input*, so `press[ore] = plate` and `press[scrap] = plate` are perfectly legal and give two chains converging on the same item, which is exactly the alternative route criterion 4 wants. The format had supported this all along. I'd talked myself out of it by describing the constraint slightly wrong.

**The version that scored better was worse.** My first attempt let one-source levels press straight to the target. Acceptance jumped to 53 out of 200 — far better than 36. I threw it away. A direct press means the target no longer needs a fan-out, so the `insufficient_fanout` proof stopped applying and that rejection class collapsed from 24 to 6; I'd have been buying acceptance by hollowing out one of only two things the validator can *prove*. And the "choice" it created was fake anyway: pressing costs 5 against 11 to assemble, so one route dominates and the player isn't deciding anything. The alternatives now go *upstream* of the target instead, which keeps the fan-out proof meaningful and makes the second idea a real one.

There's a mutation test that swaps the good design for the rejected one and checks the suite goes red, which is the closest I can get to writing down "don't do this again" in a way that enforces itself.

## A mirror image is not a second idea

Before wiring up those converging chains I built one by hand to see what it did. It enumerated five plans and the validator called all five materially different:

| cost | machines | drawn from |
|---:|---|---|
| 16 | assembler + press + splitter | `ore` |
| 16 | assembler + press + splitter | `scrap` |
| 18 | assembler + press + press | both |
| 21 | assembler + press + press + splitter | `ore` |
| 21 | assembler + press + press + splitter | `scrap` |

Rows 1 and 2 are the same factory built from the other source. So are 4 and 5. Three ideas, counted as five.

That's the wigglier-belt problem — the thing §5 was *written* to prevent — recurring one level up. My canonical form labelled the flow graph with concrete item types, so `source:ore->press` and `source:scrap->press` read as different ideas. A mirror image is not a second idea any more than a detour is.

The fix is to make the form invariant under renaming item types: take the smallest string over every bijective renaming, so isomorphic plans collapse. It's exact rather than a heuristic, and it can't conflate `x + x` with `x + y`, because a bijection can't — which is the one thing it must never do, since that distinction is the entire level-001 lesson.

Two things about this I care about more than the fix itself.

**It was latent, and the ordering was deliberate.** The generator had never emitted two source types reaching the same item, so no batch was ever miscounted. I found it by building the level that would trigger it *before* writing the generator that would produce it. Re-running the fifty afterwards: zero records changed, zero `distinct_forms` moved. Provably a no-op — which is the only reason none of the numbers in this write-up had to be withdrawn. Had I done the two changes in the other order, every figure above would have been quietly inflated and I'd have published them.

**It nearly broke the search.** `enumeratePlans` deduplicated its candidate plans using the same canonical form, so collapsing mirrors there would have stopped the solver ever building from the second source — a mirror is one *idea* but two different *things to build*, because the sources sit at different cells and route differently. Two genuinely distinct concepts had been sharing one function because they'd never disagreed before. They're separate now, and the search is bit-for-bit unchanged.

## What surprised me

**Twice, a bug looked like bad luck.** Early on, every single placement attempt failed to route — 1000 out of 1000. A random search failing 100% of the time isn't unlucky, it's broken. The cause was that I paired the splitter's two outputs to the assembler's two inputs in index order, which made the two belt runs cross. A hex grid has no crossings, so nothing could ever route. The real solution uses the opposite pairing.

Fixing that exposed a second one: one plan had a single source feeding two presses, which is physically impossible — a source has one output port. The planner had been emitting layouts no grid could realise and pricing them at 18. Adding the required splitter brought the cost to 21, which is exactly what the design doc had said all along. The planner had been quietly disagreeing with the spec and the spec was right.

**The obvious optimisation made things worse.** With the search now the bottleneck, I tried sampling runner-up machine rotations instead of always taking the best-aligned one, on the theory that a deterministic heuristic fails identically on every restart. It pushed the number of candidates finding nothing from 23 to 29. Attempts spent on worse orientations are attempts not spent on fresh placements. Reverted — and recorded, because a negative result is the evidence against the next person's obvious idea.

**Every layout that routed, won.** Of 16,500 attempts, 833 produced a complete factory and *all 833* of them delivered. Not one routed successfully and then failed to run. The planner and router produce correct factories whenever they produce anything; the entire bottleneck is geometric, not logical.

**A search problem turned out to be an arithmetic problem.** Splitting one rejection code into two was meant to be bookkeeping. It surfaced five levels that were provably impossible for a reason no amount of searching would have found, because the impossibility was about port counts and the search was about geometry. I'd been treating "the solver found nothing" as a single phenomenon for the entire project.

**The weakness of the search was leaking into the puzzles.** I thought a bounded search cost me candidates it couldn't solve. It also cost me *accuracy on the ones it could* — par is the cheapest solution found, so every gap in the search showed up as a puzzle scored too generously. Improving the router dropped one accepted level's par from 26 to 21. Nothing was broken; the number was just soft, and no test could have told me, because "cheapest found" is exactly what it claimed to be.

## The building the validator can't think about

One of the five placeable buildings never appears in anything the validator produces. The merger — two inputs, one output — is offered by the palette on roughly half the generated levels, is fully implemented in the simulator, and shows up in **zero** plans, because the planner has no merger node.

I found this auditing what was left rather than by anything failing, which is the uncomfortable way to find things. It looks exactly like an oversight.

It isn't, and the argument is short. A merger adds a building and removes none, so it can only pay for itself through throughput — joining two streams into one. Throughput never binds in this game: five items wanted, 300 ticks allowed, and one press produces an item every two ticks. So any winning factory with a merger has a cheaper winning twin without it, found by deleting the merger and one of its feeder chains.

I built both rather than leave it as an argument. On a two-source level, the merger layout wins — it's a real factory — and costs **8 against 3**, delivering in **9 ticks against 8**. Dominated on cost *and* speed.

So teaching the planner about mergers would add only dominated plans. They could never be par; their sole effect would be inflating `distinct_forms` with factories nobody would build. That's the mirror-image problem again wearing a different hat, and criterion 4 is meant to count ideas, not decorations. The omission stays, now with a test that constructs both layouts and asserts the domination, so the reasoning can't quietly rot.

What I'm careful *not* to claim: a merger has no input filter, so a hand-built solution could merge two different item types onto one shared belt to save conveyor cost, and if it saved more than three it would win. The planner models one item type per node and can't express that at all. So the honest statement is "no merger appears in a cheapest plan the planner can represent" — weaker than "no merger appears in a cheapest solution", and the gap between those two sentences is the whole reason this project keeps separate words for bounds and proofs.

## Limitations, plainly

The search is bounded and nowhere near exhaustive. It finds *a* solution often enough to judge a level — about 3.6% of attempts succeed, down from 7% because the richer chemistry produces harder plans — and its silence is never evidence of impossibility.

The 14% acceptance rate is low, and `single_solution` is still the biggest rejection class even after the generator work. The recipe format is the next real constraint, and this time I've checked the claim: `press` maps each input to exactly one output, so an item can never have a *choice* of transformations. Giving it one means each placed press has to know which recipe it runs — per-machine configuration the player selects, which touches the level format, the `Placement` format, the simulator, the UI and the search space all at once. That's a gameplay feature wearing a validation costume, and the roadmap is explicit that Phase 3 is the payload.

Five changes in and the pattern is clear enough to state: each one moved the headline number by a few points and taught me something I had wrong about the *previous* one. The rip-up failure corrected my reading of the tally. The placement work exposed that acceptance and par pull against each other. The generator work revealed that the acceptance criterion I was proudest of had been selecting for a single puzzle shape the whole time — and then that the definition underneath it would have started over-counting the moment I made the generator any richer. I'd assume there's at least one more waiting, and on current form it'll be something I currently believe.

The accepted puzzles span eight machine shapes now rather than two, but most still lean on an assembler consuming two of one item somewhere in the chain. The fan-out check sharpens that into something slightly uncomfortable: the generator's most productive shape is also the one that's impossible without a splitter, and it withholds the splitter 25% of the time. Five of the fifty candidates were doomed at the moment they were proposed.

The obvious fix — have the generator always offer a splitter when it writes an `x + x` recipe — is one I've deliberately not made. The spec's §2 says the generator proposes and the validator disposes, and that pre-screening its own output would hollow out the rejection log. Those five rejections are real information about a real generator. Laundering them away would make the acceptance rate look better and the artifact worth less.

And the refinement I'd make next: the placement search. 95% of attempts die at routing, and each failure throws away a placement that was fine — the machines were down, one belt run couldn't find a lane, and the whole attempt is discarded. Retrying the routing with a different belt order before abandoning the placement would reuse that work. I'd want to measure it rather than assume it, given the rotation experiment above.

## Try it

The game is at **[nuenoir.github.io/factory-puzzle](https://nuenoir.github.io/factory-puzzle/)**. Source at **[github.com/nuenoir/factory-puzzle](https://github.com/nuenoir/factory-puzzle)**, including [the rules spec](rules-spec.md), [the generation spec](generation-spec.md), and [the tick-by-tick derivation](level-001.md) that the simulator had to match.

195 tests. The suite is mutation-tested — an earlier version passed against a simulator whose round-robin flag never flipped, because it asserted on item counts rather than watching the mechanic. A green suite is not automatically a correct one. The generator and validator work got the same treatment before I trusted any of it: twenty-five deliberate breakages, and the suite has to go red for every one. Two of them are worth the trouble on their own — one quietly reintroduces the depth bound the fan-out proof must not have, and one swaps a good design for the measurably worse one I rejected. That's as close as I can get to writing "don't do this again" in a form that enforces itself.
