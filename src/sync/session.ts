import { createEffect, createRoot, untrack } from 'solid-js'

import { markExpired, onLogout, session } from '@/features/auth'

import { onUnauthorized, resumeFor, startSync, stopSync, sync, wipeLocalData } from './store'

/*
┌─ sync ──────────────────────────────────────────
│  THE place sync is tied to who is signed in. Called once, from main.tsx.
├─ out ───────────────────────────────────────────
│      connectSyncToSession   start on sign-in, stop on sign-out, wipe on logout,
│                            and the mid-session 401 round trip with the auth feature
├─ example ───────────────────────────────────────
│      session becomes authenticated as acc-1  →  startSync('acc-1')
│      logout()                                →  stop, then empty the database
│      a send gets 401                         →  session.expired (banner), engine paused
│      signed in again as acc-1                →  resume;  as acc-2  →  acc-1's data emptied, fresh start
*/
// A 401 from a send or a list is the other way a session ends, and the one the
// user is in the middle of: the engine parks itself (`sync.paused`) and this
// tells the auth feature, which keeps the screen where it is and asks for a
// sign-in in place. The same sign-in is what comes back here as a new `me`:
//   same account      the engine still holds their unsent work; `resumeFor`
//                     un-parks it.
//   different account the account effect below restarts sync, and `startSync`
//                     empties a database that belongs to someone else. The old
//                     engine was paused the whole time, so none of the old
//                     account's outbox is ever sent under the new session.
//
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
        // Declared after the account effect, so on a sign-in as someone else
        // the restart is queued first - and `resumeFor` would refuse the old
        // engine either way.
        let wasExpired = false
        createEffect(
            () => session.expired,
            (expired) => {
                const signedBackIn = wasExpired && !expired
                wasExpired = expired
                const accountId = untrack(() => session.me?.account_id)
                if (signedBackIn && accountId) {
                    resumeFor(accountId).catch((error) => console.error('could not resume sync', error))
                }
            },
        )
        createEffect(
            () => sync.paused,
            (paused) => {
                if (paused) markExpired()
            },
        )
        return disposeRoot
    })
    const offLogout = onLogout(() => wipeLocalData())
    const offUnauthorized = onUnauthorized(markExpired)

    return () => {
        dispose()
        offLogout()
        offUnauthorized()
    }
}
