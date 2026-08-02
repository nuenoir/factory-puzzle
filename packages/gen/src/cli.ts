/**
 * Run a batch and write the rejection log. docs/generation-spec.md §6.
 *
 * The only part of this package that touches the filesystem — everything else
 * stays pure so it can be tested without one.
 *
 *   npm run generate -- --count 50 --seed 1
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Explicit extension: this file runs under plain Node, whose ESM resolver
// wants one. Everything else is loaded by a bundler and stays extensionless.
import { DEFAULT_BATCH_OPTIONS, runBatch, summarise, toJsonl } from './batch.ts'

function flag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

function textFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const count = flag('count', 50)
const startSeed = flag('seed', 1)
const logPath = resolve(textFlag('out', 'artifacts/rejections.jsonl'))
const levelsPath = resolve(textFlag('levels', 'artifacts/accepted.json'))

mkdirSync(dirname(logPath), { recursive: true })
writeFileSync(logPath, '')

process.stdout.write(`Generating ${count} candidates from seed ${startSeed}...\n`)

const { records, accepted } = runBatch({ count, startSeed, ...DEFAULT_BATCH_OPTIONS })

// Written in one go here; the format is per-line so a longer run could append
// as it goes without losing what it had already produced.
appendFileSync(logPath, toJsonl(records))
writeFileSync(levelsPath, `${JSON.stringify(accepted, null, 2)}\n`)

const summary = summarise(records)
const pct = (n: number) => `${((n / summary.total) * 100).toFixed(0)}%`

process.stdout.write(`\n  accepted   ${summary.accepted}/${summary.total} (${pct(summary.accepted)})\n`)
process.stdout.write(`\n  rejected by reason\n`)
for (const row of summary.rejections) {
  const claim = row.proven ? 'proven' : 'bounded'
  process.stdout.write(`    ${row.reason.padEnd(22)} ${String(row.count).padStart(3)}  ${pct(row.count).padStart(4)}  ${claim}\n`)
}

if (summary.cutShort > 0) {
  process.stdout.write(
    `\n  ${summary.cutShort} search(es) hit a cap rather than finishing, so their\n` +
      `  "no solution found" is not evidence of unsolvability.\n`,
  )
}

process.stdout.write(`\n  log     ${logPath}\n`)
process.stdout.write(`  levels  ${levelsPath}\n`)
