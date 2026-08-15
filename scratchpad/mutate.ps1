# Mutation testing. CLAUDE.md: "a green suite is not a correct suite."
#
# Each mutation breaks one specific behaviour on purpose. The suite MUST go red
# for every one. A mutation that survives means nothing is actually testing that
# behaviour, however many assertions appear to cover it.
#
# Two hard-won rules are baked in:
#
#   * Files are read and written with [System.IO.File]::ReadAllText/WriteAllText
#     and UTF-8. Get-Content/Set-Content round-trips corrupt every section sign
#     and em-dash in the source, and no test catches it because comments do not
#     run.
#   * Every run gets an external timeout. A mutation can produce a synchronous
#     infinite loop, which a vitest timeout cannot interrupt because the event
#     loop never yields. Ask me how I know.
#
# Usage:  pwsh -File scratchpad/mutate.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding $false
$timeoutSeconds = 240

# Each mutation: the file, a literal to find, what to replace it with, and the
# behaviour it is meant to destroy.
$mutations = @(
  @{
    file = 'packages/gen/src/chemistry.ts'
    from = 'if ((l & r) === 0) masks.add(l | r)'
    to   = 'masks.add(l | r)'
    kills = 'fan-out proof: lets two arms share one source'
  },
  @{
    file = 'packages/gen/src/chemistry.ts'
    from = 'return masksFor(level.target.type, new Set()).size > 0'
    to   = 'return true'
    kills = 'fan-out proof: never finds anything infeasible'
  },
  @{
    file = 'packages/gen/src/chemistry.ts'
    from = 'if (chain.has(type)) return masks'
    to   = 'if (chain.size >= 2) return masks'
    kills = 'fan-out proof: depth-bounds the enumeration, so a deep route is missed'
  },
  @{
    file = 'packages/gen/src/chemistry.ts'
    from = "const assemblers = level.available.includes('assembler') ? (level.recipes.assembler ?? []) : []`n`n  /** Source-index bitmasks"
    to   = "const assemblers: never[] = []`n`n  /** Source-index bitmasks"
    kills = 'fan-out proof: ignores assembler recipes entirely'
  },
  @{
    file = 'packages/gen/src/validator.ts'
    from = "const reason = outcome.plansTried === 0 ? 'no_plan_within_depth' : 'no_placement_found'"
    to   = "const reason = 'no_placement_found' as const"
    kills = 'splitting the two stage-C bounds apart'
  },
  @{
    file = 'packages/gen/src/validator.ts'
    from = "if (!level.available.includes('splitter') && !deliverableWithoutFanout(level)) {"
    to   = 'if (false) {'
    kills = 'stage-B fan-out rejection firing at all'
  },
  @{
    file = 'packages/gen/src/batch.ts'
    from = "  'insufficient_fanout',`n])"
    to   = '])'
    kills = 'labelling the new proven code as proven'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'const plans = enumeratePlans(level, limits)'
    to   = 'const plans = enumeratePlans(level)'
    kills = 'threading the plan caps into the search that reports them'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'for (let retry = 0; retry < Math.max(1, retries); retry += 1) {'
    to   = 'for (let retry = 0; retry < 1; retry += 1) {'
    kills = 'retrying the wiring at all'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'Math.max(1, retries)'
    to   = 'retries'
    kills = 'guarding against a retry count of zero'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'const result = attempt(level, plan, random, limits.routeRetries, samples)'
    to   = 'const result = attempt(level, plan, random, 1, samples)'
    kills = 'honouring the configured retry count'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = "    if (wired.stage === 'ports') break"
    to   = ''
    kills = 'breaking early on a failure that cannot differ between passes'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'const samples = i % 2 === 0 ? 1 : limits.placementSamples'
    to   = 'const samples = 1'
    kills = 'sampling for elbow room at all'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'const wanted = Math.max(1, samples)'
    to   = 'const wanted = samples'
    kills = 'guarding against a sample count of zero'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'elbowRoom(cell, level.grid, taken) > elbowRoom(best, level.grid, taken) ? cell : best'
    to   = 'best'
    kills = 'actually preferring the roomier of the sampled cells'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = 'if (!taken.has(`${n.x},${n.y}`)) free += 1'
    to   = 'free += 1'
    kills = 'counting only the neighbours a belt could really use'
  },
  @{
    file = 'packages/gen/src/generator.ts'
    from = 'if (options.alternativeRoutes && chance(0.55)) {'
    to   = 'if (false) {'
    kills = 'offering a second route to the target at all'
  },
  @{
    file = 'packages/gen/src/generator.ts'
    from = 'assembler.push({ in: [base, base], out: deepest })'
    to   = 'press[deepest] = output'
    kills = 'keeping the target behind a fan-out (this IS the rejected design)'
  },
  @{
    file = 'packages/gen/src/generator.ts'
    from = 'assembler.push({ in: [deepest, deepest], out: output })'
    to   = ''
    kills = 'adding the same-type pair as an alternative to a two-arm recipe'
  },
  @{
    file = 'packages/gen/src/generator.ts'
    from = 'press[secondSourceType] = deepest'
    to   = 'press[secondSourceType] = freshType()'
    kills = 'converging the second chain on the same item'
  },
  @{
    file = 'packages/gen/src/generator.ts'
    from = 'const alreadyHave = (a: ItemType, b: ItemType) =>'
    to   = 'const alreadyHave = (_a: ItemType, _b: ItemType) => false && '
    kills = 'refusing to emit a duplicate recipe rules-spec 3 rejects at load'
  },
  @{
    file = 'packages/sim/src/types.ts'
    from = '  merger: 3,'
    to   = '  merger: 0,'
    kills = 'a merger costing something, which is why it can never be par'
  },
  @{
    file = 'app/editor.ts'
    from = "return isFixture && tool !== 'conveyor'"
    to   = 'return isFixture'
    kills = 'letting a belt drag reach a sink (THIS is the four-in-five bug)'
  },
  @{
    file = 'app/trace.ts'
    from = 'if (!Number.isFinite(tick) || tick < 1) continue'
    to   = ''
    kills = 'ignoring delivery ticks that cannot have happened'
  },
  @{
    file = 'app/trace.ts'
    from = 'const span = Math.max(1, totalTicks)'
    to   = 'const span = totalTicks'
    kills = 'guarding the trace against a zero-tick run'
  },
  @{
    file = 'app/trace.ts'
    from = 'Math.floor(((tick - 1) / span) * width)'
    to   = 'Math.floor((tick / span) * width)'
    kills = 'placing 1-based ticks in the right segment'
  },
  @{
    file = 'app/run.ts'
    from = "  if (facts.delivered >= facts.target) return 'won'`n  if (facts.tickCount >= facts.maxTicks) return 'timeout'"
    to   = "  if (facts.tickCount >= facts.maxTicks) return 'timeout'`n  if (facts.delivered >= facts.target) return 'won'"
    kills = 'checking the win before the tick limit, per rules-spec 10'
  },
  # The section-5 canonical form. Each of these is a different way of getting
  # "materially different" wrong, which is the project's headline claim.
  @{
    file = 'packages/gen/src/planner.ts'
    from = 'const types = [...new Set(plan.nodes.map((n) => n.item))]'
    to   = 'const types: string[] = []'
    kills = 'renaming item types at all, so mirror-image plans count twice'
  },
  @{
    file = 'packages/gen/src/planner.ts'
    from = 'if (best === null || form < best) best = form'
    to   = 'if (best === null) best = form'
    kills = 'taking the *smallest* form, so the canonical choice is arbitrary'
  },
  @{
    file = 'packages/gen/src/planner.ts'
    from = '      const identity = planIdentity(plan)'
    to   = '      const identity = canonicalPlan(plan)'
    kills = 'keeping mirror plans in the search even though they are one idea'
  },
  # The coach and the tutorial both answer "is this wired up?", and both would
  # look fine while quietly reading adjacency instead of the section-4 facing
  # rule. That is the exact bug they exist to explain, so it is the exact
  # mutation worth proving they catch.
  @{
    file = 'app/coach.ts'
    from = "    if (n.x === to.x && n.y === to.y) return to.inPorts.includes(opposite(d))`n  }`n  return false`n}`n`n/** Anything adjacent"
    to   = "    if (n.x === to.x && n.y === to.y) return true`n  }`n  return false`n}`n`n/** Anything adjacent"
    kills = 'the coach checking that the far building faces back'
  },
  @{
    file = 'app/coach.ts'
    from = '  if (!makeableNow(level, built).has(target)) {'
    to   = '  if (false) {'
    kills = 'noticing a tidily wired board that cannot make the target at all'
  },
  # The four-in-five shape, second time around. Asking "is ANY source idle?"
  # instead of "is nothing being drawn at all?" called 74 winning pool boards
  # broken and masked the sink lesson on 50 of them, and every hand-built world
  # in coach.test.ts agreed it was fine because every one of them has one source.
  @{
    file = 'app/coach.ts'
    from = '  if (idleSources.length > 0 && idleSources.length === sources.length) {'
    to   = '  if (idleSources.length > 0) {'
    kills = 'leaving a spare source alone on a two-source level (THIS is the 74-level bug)'
  },
  # Same shape a third time: a machine whose inputs are alternatives rather than
  # requirements. rules-spec section 14 case 12 is *named* "merger starvation".
  @{
    file = 'app/coach.ts'
    from = "    return b.type === 'merger' ? unfed.length === b.inPorts.length : true"
    to   = '    return true'
    kills = 'letting half a merger be a waste of money rather than a fault'
  },
  @{
    file = 'app/editor.ts'
    from = "  if (tool === 'delete' || available.includes(tool)) return tool"
    to   = '  return tool'
    kills = 'dropping a tool the level being switched to does not offer'
  },
  @{
    file = 'app/tutorial.ts'
    from = "    text: 'Choose BELT and run one from the press into the sink."
    to   = "    text: 'Now run one from the press into the sink."
    kills = 'naming the tool in a step that places something'
  },
  @{
    file = 'app/tutorial.ts'
    from = '    if (n.x === to.x && n.y === to.y) return to.inPorts.includes(opposite(d))'
    to   = '    if (n.x === to.x && n.y === to.y) return true'
    kills = 'the tutorial accepting a belt that is merely beside the sink'
  },
  @{
    file = 'app/tutorial.ts'
    from = '  return steps.find((step) => !step.done(board)) ?? null'
    to   = '  return steps.find((step) => step.done(board)) ?? null'
    kills = 'showing the earliest step still outstanding'
  },
  @{
    file = 'app/tutorial.ts'
    from = "    done: ({ status }) => status === 'won',"
    to   = "    done: () => true,"
    kills = 'ending the tutorial on a win rather than on a full-looking board'
  }
)

$survivors = @()
$index = 0

foreach ($m in $mutations) {
  $index += 1
  $path = Join-Path $root $m.file
  $original = [System.IO.File]::ReadAllText($path)

  if (-not $original.Contains($m.from)) {
    Write-Host ("[{0}/{1}] SKIP  target text not found in {2}" -f $index, $mutations.Count, $m.file) -ForegroundColor Yellow
    Write-Host ("        looking for: {0}" -f $m.from) -ForegroundColor DarkGray
    $survivors += "$($m.kills) (mutation did not apply)"
    continue
  }

  [System.IO.File]::WriteAllText($path, $original.Replace($m.from, $m.to), $utf8)
  try {
    # npx is a .cmd shim on Windows, which Start-Process cannot launch directly.
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npx vitest run --reporter=dot' `
      -WorkingDirectory $root -NoNewWindow -PassThru `
      -RedirectStandardOutput (Join-Path $env:TEMP "mutate-$index.out") `
      -RedirectStandardError  (Join-Path $env:TEMP "mutate-$index.err")

    if (-not $proc.WaitForExit($timeoutSeconds * 1000)) {
      $proc.Kill($true)
      # A hang is a kill: the mutation changed behaviour so drastically the
      # suite could not finish, which is still the suite noticing.
      Write-Host ("[{0}/{1}] KILLED (hung) {2}" -f $index, $mutations.Count, $m.kills) -ForegroundColor Green
      continue
    }

    if ($proc.ExitCode -eq 0) {
      Write-Host ("[{0}/{1}] SURVIVED     {2}" -f $index, $mutations.Count, $m.kills) -ForegroundColor Red
      $survivors += $m.kills
    } else {
      Write-Host ("[{0}/{1}] killed       {2}" -f $index, $mutations.Count, $m.kills) -ForegroundColor Green
    }
  } finally {
    # Restore before anything else can go wrong, always.
    [System.IO.File]::WriteAllText($path, $original, $utf8)
  }
}

Write-Host ''
if ($survivors.Count -eq 0) {
  Write-Host ("All {0} mutations killed." -f $mutations.Count) -ForegroundColor Green
} else {
  Write-Host ("{0} of {1} mutations SURVIVED:" -f $survivors.Count, $mutations.Count) -ForegroundColor Red
  $survivors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
