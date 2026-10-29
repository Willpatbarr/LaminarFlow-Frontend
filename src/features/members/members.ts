import { createSignal } from 'solid-js'

import { api } from '@/api/client'
import type { components } from '@/api/schema'
import { PAGE_SIZE } from '@/sync/http'

/*
┌─ members ───────────────────────────────────────
│  the people in the signed-in account's workspace (LAM-121)
├─ out ───────────────────────────────────────────
│      Member            the server's body: account_id, display_name, email, role
│      members()         the list last loaded, by name; empty until it is
│      loadMembers()     asks for it (one request at a time); true when it answered
│      ensureMembers()   loadMembers() once: a no-op after it has answered (LAM-128)
│      memberName(id)    a person's display name, or undefined when not known
*/
// Not a sync entity: nothing in the change feed announces a joiner, so the list
// is asked for when a screen needs names (a comment thread, the reviewer picker)
// and kept for the page's life. A failed ask leaves the old list, and the screens
// fall back to the neutral wording they had before there was a list.

export type Member = components['schemas']['MemberBody']

const [list, setList] = createSignal<Member[]>([])
let inFlight: Promise<boolean> | null = null
let answered = false

export const members = list

export function loadMembers(): Promise<boolean> {
    inFlight ??= (async () => {
        try {
            const found: Member[] = []
            let cursor: string | undefined
            for (;;) {
                const { data } = await api.POST('/api/v1/members/list', { body: { limit: PAGE_SIZE, cursor } })
                if (!data) return false
                found.push(...(data.items ?? []))
                if (!data.has_more || !data.next_cursor) break
                cursor = data.next_cursor
            }
            setList(found)
            answered = true
            return true
        } catch {
            return false
        } finally {
            inFlight = null
        }
    })()
    return inFlight
}

/** For screens that only need names to be there (assignee markers, pickers):
 *  asks once, and again only after a failed ask or a `clearMembers`. */
export function ensureMembers(): Promise<boolean> {
    return answered ? Promise.resolve(true) : loadMembers()
}

export function memberName(id: string | null): string | undefined {
    if (id === null) return undefined
    return list().find((member) => member.account_id === id)?.display_name
}

/** Forgets the list, for when the account changes. */
export function clearMembers() {
    setList([])
    answered = false
}
