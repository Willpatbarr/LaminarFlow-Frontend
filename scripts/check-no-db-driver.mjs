// Fails if the frontend ever gains a database driver or a connection string.
//
// LAM-2 step 4 asked to "confirm the React frontend has no Postgres driver or
// connection string anywhere". That was a one-time check, and a one-time check
// is exactly what LAM-5 concluded is not enough: structure makes the right path
// easy, not the wrong path impossible. Nothing stopped `npm install pg`.
//
// The boundary this protects is from the Architecture notes: the Go backend is
// the only component that talks to Postgres. The frontend reaches it over HTTP,
// which is what makes permission checks and workspace scoping unbypassable.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// Package names that only make sense if something here is talking to a database
// directly. Substring-matched, so `pg-promise` and `@prisma/client` are caught
// by `pg` and `prisma`.
const BANNED_DEPS = [
  'pg', 'postgres', 'pgx', 'prisma', 'drizzle', 'knex', 'sequelize',
  'typeorm', 'mysql', 'sqlite', 'mongodb', 'mongoose',
]

// A connection string in frontend source is the other half of the same mistake:
// it means credentials are shipping to the browser.
const BANNED_SOURCE = /postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|DATABASE_URL/

const problems = []

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(pkg[field] ?? {})) {
    const bare = name.replace(/^@[^/]+\//, '')
    if (BANNED_DEPS.some((b) => bare === b || bare.startsWith(`${b}-`) || bare.endsWith(`-${b}`))) {
      problems.push(`package.json ${field}: ${name}`)
    }
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    if (!['.ts', '.tsx', '.js', '.jsx', '.mts'].includes(extname(full))) continue

    const text = readFileSync(full, 'utf8')
    text.split('\n').forEach((line, i) => {
      if (BANNED_SOURCE.test(line)) problems.push(`${full}:${i + 1}`)
    })
  }
}
walk('src')

if (problems.length > 0) {
  console.error('✗ The frontend must not talk to a database directly.')
  console.error('  The Go backend is the only component that touches Postgres;')
  console.error('  everything here goes through its HTTP API. Found:')
  for (const p of problems) console.error(`      ${p}`)
  process.exit(1)
}

console.log('✓ no database drivers or connection strings in the frontend')
