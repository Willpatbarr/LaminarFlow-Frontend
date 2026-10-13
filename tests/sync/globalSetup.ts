// Runs once before any test file. If there is no stack, the run fails here with
// a message that says what to do - a sync suite that skipped itself when the
// server was missing would be green while testing nothing.
export async function setup() {
  const base = process.env.SYNC_BASE_URL
  if (!base) {
    throw new Error(
      'SYNC_BASE_URL is not set. `npm run test:sync` needs a running backend: ' +
        'use ./scripts/test-stack.sh (it starts one, runs this suite, and removes it), ' +
        'or point SYNC_BASE_URL at one you started yourself.',
    )
  }
  let health: Response
  try {
    health = await fetch(new URL('/healthz/db', base), { signal: AbortSignal.timeout(5_000) })
  } catch (error) {
    throw new Error(`the backend at ${base} is unreachable: ${String(error)}`)
  }
  if (!health.ok) {
    throw new Error(`the backend at ${base} answered /healthz/db with ${health.status}; its database is not ready`)
  }
}
