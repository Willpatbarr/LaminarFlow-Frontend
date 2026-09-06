/*
╔═ api-pull.mjs ════════════════════════════════════════════════════════════════════════
║  tooling · api contract
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      npm run api:pull  →  api/openapi.json
╚═══════════════════════════════════════════════════════════════════════════════════════
*/

import { mkdirSync, writeFileSync } from 'node:fs'

const repo = 'https://raw.githubusercontent.com/Willpatbarr/LaminarFlow-Backend'
const ref = process.env.API_REF ?? 'main'
const url = `${repo}/${ref}/api/openapi.json`

const res = await fetch(url)

if (!res.ok) {
    console.error(`✗ ${res.status} fetching ${url}`)
    process.exit(1)
}

mkdirSync('api', { recursive: true })
writeFileSync('api/openapi.json', await res.text())
console.log(`✓ pulled api/openapi.json from ${ref}`)