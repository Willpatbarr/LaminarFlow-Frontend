import { useLocation, useNavigate } from '@solidjs/router'
import { createEffect } from 'solid-js'

import { sync } from '@/sync'

// A row made on this device lives under a temporary id (`tmp_epic_…`) until the
// server answers its create; the engine then re-keys it and records
// tmp id -> real id (`sync.aliases`, kept in the local database). The address
// bar can hold the old id - a path (`/sprints/tmp_…`) or a query value
// (`?view=tmp_saved_view_…`) - so the address is rewritten to the new one.
// One rule for every kind of row, tickets and documents included.

const TEMP_ID = /tmp_[A-Za-z0-9_-]+/g

/** `url` (path, query and hash) with every temporary id that has a real id
 *  swapped for it, or null when nothing in it changes. */
export function rekeyedUrl(url: string, aliases: Readonly<Record<string, string>>): string | null {
    let changed = false
    const next = url.replace(TEMP_ID, (id) => {
        // Follow a chain, though the engine only ever records tmp -> real.
        let to = aliases[id]
        for (let hops = 0; to !== undefined && aliases[to] !== undefined && hops < 5; hops++) to = aliases[to]
        if (to === undefined || to === id) return id
        changed = true
        return to
    })
    return changed ? next : null
}

/** Replaces the current route (no new history entry) when it holds an id the
 *  engine has re-keyed, now or after a reload with a persisted map. */
export function useRekeyRoute() {
    const location = useLocation()
    const navigate = useNavigate()
    createEffect(
        () => ({ url: `${location.pathname}${location.search}${location.hash}`, aliases: { ...sync.aliases } }),
        ({ url, aliases }) => {
            const next = rekeyedUrl(url, aliases)
            if (next) navigate(next, { replace: true })
        },
    )
}
