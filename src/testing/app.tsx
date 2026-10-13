import { memoryHistory } from '@solidjs/router'
import { render } from '@solidjs/testing-library'

import { refresh } from '@/features/auth'
import { createAppRouter } from '@/router'
import { ME } from '@/sync/testing/harness'
import { ok, problem, stubFetch } from '@/testing/fetch'

// The whole app, the way the failure tests need it: the real route tree on a
// memory history, the real session, store and engine on fake-indexeddb, with
// only `fetch` stubbed.

export const ME_BODY = {
    account_id: ME,
    via: 'session',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    workspace_id: 'ws-1',
    permissions: [],
}

export type Routes = Parameters<typeof stubFetch>[0]

/** The session store is module state, so each test starts by being told that
 *  nobody is signed in. Call before `connectSyncToSession()`. */
export async function startAnonymous() {
    stubFetch({ 'GET /api/v1/auth/me': () => problem(401, 'unauthorized') })
    await refresh()
}

/** Signs in as `me`, then mounts the app at `url`. */
export async function openApp(url: string, routes: Routes, me: object = ME_BODY) {
    stubFetch({ 'GET /api/v1/auth/me': () => ok(me), ...routes })
    await refresh()
    const history = memoryHistory(url)
    const Router = createAppRouter(history)
    render(() => <Router />)
    return history
}
