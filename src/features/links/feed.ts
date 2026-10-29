import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'

import type { Result } from '@/features/aspects/api'
import { isTempId, onLinkEvent, resolveId, type LinkEvent } from '@/sync'

/*
┌─ links ─────────────────────────────────────────
│  createLinkFeed: one side's list of links, kept current
├─ out ───────────────────────────────────────────
│      createLinkFeed({ owner, load, concerns })
│          → { items, loaded, problem, add(item, send), remove(id, send), reload }
*/
// `owner` is the ticket or document the list belongs to (an id from the URL,
// possibly a temporary one). Nothing is asked until the server has the owner:
// a row made offline has no links to list. The list is asked for on opening,
// when a link event for this owner arrives, and when the tab is shown again; the
// answer replaces whatever was held.
//
// A write shows at once and is then sent: `add` / `remove` lay the change over
// the last list the server gave, and take it off again when the answer comes
// (the list is then read again, which is the truth). A refusal, or no connection,
// is said in `problem` and the list goes back to what the server has.

type Item = { id: string }

type FeedOptions<T extends Item> = {
    owner: () => string
    load: (ownerId: string) => Promise<Result<T[]>>
    /** The id of the link's other end, when the event is about this owner. */
    concerns: (event: LinkEvent, ownerId: string) => string | null
}

export function createLinkFeed<T extends Item>(options: FeedOptions<T>) {
    const [server, setServer] = createSignal<T[] | null>(null)
    const [added, setAdded] = createSignal<T[]>([])
    const [removed, setRemoved] = createSignal<string[]>([])
    const [problem, setProblem] = createSignal<string | null>(null)
    const [loadProblem, setLoadProblem] = createSignal(false)
    let latest = 0

    const ownerId = () => resolveId(options.owner())
    const ready = () => !isTempId(ownerId())

    async function reload() {
        const id = untrack(ownerId)
        if (isTempId(id)) return
        const ticket = ++latest
        const result = await options.load(id)
        if (ticket !== latest) return
        if (result.ok) {
            setServer(result.data)
            setLoadProblem(false)
        } else {
            // Said apart from a refused write: it is not an alert, and the list
            // held (if any) is still the best there is.
            setLoadProblem(true)
        }
    }

    createEffect(
        () => (ready() ? ownerId() : null),
        (id) => {
            setServer(null)
            if (!id) return
            void reload()
            const shown = () => {
                if (document.visibilityState !== 'hidden') void reload()
            }
            document.addEventListener('visibilitychange', shown)
            const off = onLinkEvent((event) => {
                if (options.concerns(event, id) !== null) void reload()
            })
            onCleanup(() => {
                document.removeEventListener('visibilitychange', shown)
                off()
            })
        },
    )

    const items = createMemo(() => {
        const gone = removed()
        const shown = (server() ?? []).filter((item) => !gone.includes(item.id))
        for (const item of added()) if (!shown.some((other) => other.id === item.id)) shown.push(item)
        return shown
    })

    /** `send` answers with the id the server knows the item by: the item may have
     *  been named by a temporary id until now. */
    async function add(item: T, send: () => Promise<Result<string>>) {
        setProblem(null)
        setRemoved((ids) => ids.filter((id) => id !== item.id))
        setAdded((all) => [...all.filter((other) => other.id !== item.id), item])
        const result = await send()
        setAdded((all) => all.filter((other) => other.id !== item.id))
        if (result.ok) {
            setServer((all) => [...(all ?? []).filter((other) => other.id !== result.data), { ...item, id: result.data }])
            void reload()
        } else {
            setProblem(result.message)
        }
        return result.ok
    }

    async function remove(id: string, send: () => Promise<Result<unknown>>) {
        setProblem(null)
        setAdded((all) => all.filter((other) => other.id !== id))
        setRemoved((ids) => [...ids, id])
        const result = await send()
        setRemoved((ids) => ids.filter((other) => other !== id))
        if (result.ok) {
            setServer((all) => (all ?? []).filter((other) => other.id !== id && other.id !== resolveId(id)))
            void reload()
        } else {
            setProblem(result.message)
        }
        return result.ok
    }

    return {
        items,
        /** False until the server has answered once (or the owner has no server copy yet). */
        loaded: () => server() !== null || !ready(),
        problem,
        /** The list could not be read the last time it was asked for. */
        loadProblem,
        add,
        remove,
        reload,
    }
}
