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
    from = 'const result = attempt(level, plan, random, limits.routeRetries)'
    to   = 'const result = attempt(level, plan, random, 1)'
    kills = 'honouring the configured retry count'
  },
  @{
    file = 'packages/gen/src/solver.ts'
    from = "    if (wired.stage === 'ports') break"
    to   = ''
    kills = 'breaking early on a failure that cannot differ between passes'
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
