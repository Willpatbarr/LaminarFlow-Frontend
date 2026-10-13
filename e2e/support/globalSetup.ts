// Runs once before any spec. With no stack the run fails here, with the way to
// get one, instead of every spec timing out on a connection error.
export default async function globalSetup() {
    const base = process.env.E2E_BASE_URL ?? process.env.SYNC_BASE_URL
    if (!base) {
        throw new Error(
            'No stack to test against: neither E2E_BASE_URL nor SYNC_BASE_URL is set.\n' +
                '  npm run test:e2e:stack            builds and starts one, runs the specs, removes it\n' +
                '  scripts/test-stack.sh up          starts one and prints the SYNC_BASE_URL to export',
        )
    }
    let health: Response
    try {
        health = await fetch(new URL('/healthz/db', base), { signal: AbortSignal.timeout(5_000) })
    } catch (error) {
        throw new Error(
            `The backend at ${base} is unreachable (${String(error)}).\n` +
                'Start the stack with `scripts/test-stack.sh up`, or use `npm run test:e2e:stack`.',
        )
    }
    if (!health.ok) {
        throw new Error(`The backend at ${base} answered /healthz/db with ${health.status}: its database is not ready.`)
    }
    // Specs are written against the bundle the backend serves, so the page must
    // be there. (A backend image without the frontend answers 404 here.)
    const page = await fetch(new URL('/login', base), { signal: AbortSignal.timeout(5_000) })
    if (!page.ok || !(await page.text()).includes('<div id="root"')) {
        throw new Error(`The backend at ${base} does not serve the frontend bundle at /login (got ${page.status}).`)
    }
}
