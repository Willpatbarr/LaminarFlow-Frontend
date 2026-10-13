import { recheckExpired } from './session'

/*
┌─ auth ──────────────────────────────────────────
│  when to look again at a "signed out" banner that may be wrong
├─ out ───────────────────────────────────────────
│      watchExpiredSession   re-check on the tab coming back and on the network coming back
│      Triggers              the two events it needs, injectable
├─ example ───────────────────────────────────────
│      banner showing, tab hidden for an hour, tab shown  →  GET /auth/me; 200 clears the banner
*/
// Two events and no timer. A banner that is wrong is almost always noticed by
// the person coming back to the tab, and the network returning is the other
// moment a 401 that was only the connection's trouble stops being true. Polling
// would be traffic for a state that nobody is looking at.

export type Triggers = {
    /** Calls `fn` each time the tab comes to the front. Returns the unsubscribe. */
    onVisible(fn: () => void): () => void
    /** Calls `fn` each time the browser reports the network back. */
    onOnline(fn: () => void): () => void
}

export const browserTriggers: Triggers = {
    onVisible(fn) {
        const listener = () => {
            if (document.visibilityState !== 'hidden') fn()
        }
        document.addEventListener('visibilitychange', listener)
        return () => document.removeEventListener('visibilitychange', listener)
    },
    onOnline(fn) {
        window.addEventListener('online', fn)
        return () => window.removeEventListener('online', fn)
    },
}

/** Starts watching; returns the function that stops. `recheckExpired` does
 *  nothing unless the banner is showing, so this costs nothing otherwise. */
export function watchExpiredSession(triggers: Triggers = browserTriggers): () => void {
    const check = () => void recheckExpired()
    const offVisible = triggers.onVisible(check)
    const offOnline = triggers.onOnline(check)
    return () => {
        offVisible()
        offOnline()
    }
}
