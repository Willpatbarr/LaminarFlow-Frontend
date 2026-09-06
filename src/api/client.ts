/*
╔═ client.ts ═══════════════════════════════════════════════════════════════════════════
║  api · typed fetch client
╠═ declares ════════════════════════════════════════════════════════════════════════════
║      api      Client<paths>
╠═ reached from ════════════════════════════════════════════════════════════════════════
║      every feature's api/ folder
╚═══════════════════════════════════════════════════════════════════════════════════════
*/

import createClient from 'openapi-fetch'

import type { paths } from './schema'

export const api = createClient<paths>({
  baseUrl: location.origin,
  fetch: (request) => globalThis.fetch(request),
})

