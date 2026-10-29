import { isTempId, resolveId } from '@/sync'

import type { Result } from '@/features/aspects/api'

/*
┌─ links ─────────────────────────────────────────
│  settledId: the id the server knows a row by
├─ out ───────────────────────────────────────────
│      settledId(id)   Result<string>
*/
// A ticket or document made a moment ago is named by a temporary id until the
// server has answered its create, and a link can only name what the server has.
// So a link made to such a row waits for the engine to send the create (it
// does, in order, as soon as there is a connection) and is sent then. If that
// takes longer than `WAIT_MS` the link is given up with a message: nothing was
// linked, and the user can try again.

const WAIT_MS = 15_000
const EVERY_MS = 150

export async function settledId(id: string, waitMs = WAIT_MS): Promise<Result<string>> {
    const started = Date.now()
    for (;;) {
        const now = resolveId(id)
        if (!isTempId(now)) return { ok: true, data: now }
        if (Date.now() - started >= waitMs) {
            return {
                ok: false,
                code: 'not_synced',
                message: 'That is still waiting to be saved to the server. Try again once it has synced.',
            }
        }
        await new Promise((resolve) => setTimeout(resolve, EVERY_MS))
    }
}
