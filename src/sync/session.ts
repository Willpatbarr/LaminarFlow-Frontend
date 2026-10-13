import { createEffect, createRoot } from 'solid-js'

import { onLogout, session } from '@/features/auth'

import { startSync, stopSync, wipeLocalData } from './store'

/*
┌─ sync ──────────────────────────────────────────
│  THE place sync is tied to who is signed in. Called once, from main.tsx.
├─ out ───────────────────────────────────────────
│      connectSyncToSession   start on sign-in, stop on sign-out, wipe on logout
├─ example ───────────────────────────────────────
│      session becomes authenticated as acc-1  →  startSync('acc-1')
│      logout()                                →  stop, then empty the database
*/
// Two different endings, on purpose. The session turning anonymous on its own
// (it expired) only stops the engine: the unsent work on disk is still that
// user's, and is there when they sign back in. An explicit logout also wipes,
// because the next person at this browser may be someone else. Either way a
// database that belongs to a different account is emptied at the next start.
export function connectSyncToSession(): () => void {
    const dispose = createRoot((disposeRoot) => {
        createEffect(
            () => (session.status === 'authenticated' ? (session.me?.account_id ?? null) : null),
            (accountId) => {
                const done = accountId ? startSync(accountId) : stopSync()
                done.catch((error) => console.error('could not start or stop sync', error))
            },
        )
        return disposeRoot
    })
    const offLogout = onLogout(() => wipeLocalData())

    return () => {
        dispose()
        offLogout()
    }
}
