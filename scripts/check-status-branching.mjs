// Fails if a module other than src/api/errors.ts compares an HTTP status to a
// number.
//
// LAM-70 made the classifier the one place that knows what a 401, a 422 or a
// 503 means. A second `if (response.status === 401)` somewhere else is how the
// meaning of a status ends up decided twice, and differently: the sync engine
// parks on one answer while a form treats the same one as a typo. Tests may
// assert on statuses (that is what they are checking), so they are skipped,
// and so is the generated schema.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const ALLOWED = new Set(['src/api/errors.ts', 'src/api/schema.d.ts'])

const COMPARES = [
  /\bstatus\s*(?:[=!]==?|[<>]=?)\s*\d{3}/,
  /\b\d{3}\s*(?:[=!]==?|[<>]=?)\s*[\w.]*status\b/,
  /switch\s*\([^)]*\bstatus\s*\)/,
]

const problems = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    if (!['.ts', '.tsx'].includes(extname(full))) continue
    if (ALLOWED.has(full) || /\.test\.tsx?$/.test(full) || full.includes('/testing/')) continue

    readFileSync(full, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.trimStart().startsWith('//')) return
        if (COMPARES.some((pattern) => pattern.test(line))) problems.push(`${full}:${i + 1}  ${line.trim()}`)
      })
  }
}
walk('src')

if (problems.length > 0) {
  console.error('✗ Only src/api/errors.ts may compare an HTTP status to a number.')
  console.error('  Ask classify() what the failure is and branch on that. Found:')
  for (const p of problems) console.error(`      ${p}`)
  process.exit(1)
}

console.log('✓ no module but src/api/errors.ts branches on a status code')
