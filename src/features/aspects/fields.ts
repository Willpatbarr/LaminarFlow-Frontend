import { createEffect, createSignal, onCleanup, untrack } from 'solid-js'

import { getAspectType, type AspectField, type AspectType } from './api'

/*
┌─ aspects ───────────────────────────────────────
│  an aspect document's fields: their order, and a type kept current (LAM-109)
├─ out ───────────────────────────────────────────
│      orderedFields(type)              the type's fields by (position, label), as the server orders them
│      bodyForConversion(body, type)    the body a normal document has once it is an aspect
│      createAspectTypeFeed(id, again)  { type, missing, problem }, refetched when `again` changes,
│                                       when the tab is shown again, and every POLL ms
*/

/** How often a document that is open asks again for its type, in ms. The server
 *  publishes nothing when an aspect type changes, so a page that is left open
 *  has to ask. */
export const TYPE_POLL = 15_000

/** A position is a hint, not a slot (duplicates are legal), so ties break on the
 *  label: the same order the server uses to pick the first field. */
export function orderedFields(type: Pick<AspectType, 'fields'> | null | undefined): AspectField[] {
    return (type?.fields ?? []).toSorted(
        (a, b) => a.position - b.position || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    )
}

/** What the server will store when a normal document becomes an aspect: the text
 *  goes under the type's first field and every other key is dropped (ADR 0006).
 *  Sent as the body so the local copy and the server's agree. Null when the type
 *  has no field to move it to. */
export function bodyForConversion(content: string, type: Pick<AspectType, 'fields'>): Record<string, string> | null {
    const first = orderedFields(type)[0]
    return first ? { [first.id]: content } : null
}

/** One aspect type, fetched and kept fresh. `again` is anything that should
 *  trigger a refetch when it changes (the document's version, say). */
export function createAspectTypeFeed(id: () => string | null, again: () => unknown = () => null) {
    const [type, setType] = createSignal<AspectType | null>(null)
    const [missing, setMissing] = createSignal(false)
    const [problem, setProblem] = createSignal<string | null>(null)
    let latest = 0

    async function load(typeId: string) {
        const ticket = ++latest
        const result = await getAspectType(typeId)
        if (ticket !== latest) return
        if (result.ok) {
            setType(result.data)
            setMissing(false)
            setProblem(null)
        } else if (result.code === 'aspect_type_not_found') {
            setMissing(true)
        } else {
            // Keep showing the last good copy; just say it may be stale.
            setProblem(result.message)
        }
    }

    createEffect(
        () => [id(), again()] as const,
        ([typeId]) => {
            if (!typeId) return
            if (untrack(type)?.id !== typeId) setType(null)
            void load(typeId)
            const poll = setInterval(() => void load(typeId), TYPE_POLL)
            const shown = () => {
                if (document.visibilityState !== 'hidden') void load(typeId)
            }
            document.addEventListener('visibilitychange', shown)
            onCleanup(() => {
                clearInterval(poll)
                document.removeEventListener('visibilitychange', shown)
            })
        },
    )

    return { type, missing, problem }
}
