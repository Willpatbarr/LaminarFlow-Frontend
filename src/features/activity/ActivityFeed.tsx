import { createEffect, createSignal, For, onCleanup, onSettled, Show, untrack } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { getAspectType } from '@/features/aspects/api'
import { loadMembers, memberName } from '@/features/members/members'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { isTempId, onActivityEvent, resolveId, sync, type ActivityEntry } from '@/sync'

import { listActivity } from './api'
import { describe, type Names } from './describe'
import './activity.css'

/*
┌─ activity ──────────────────────────────────────
│  the history of a ticket or a document (LAM-114)
├─ out ───────────────────────────────────────────
│      ActivityFeed   <ActivityFeed entityType entityId accountId />
*/
// Newest first, one plain line per change: "You moved this from To do to Done ·
// 2 minutes ago". Read-only and online-only: it is asked for from the server on
// opening and when the tab is shown again, and `activity.created` events from the
// change feed put new lines at the top. Offline, or when the history cannot be
// had, it says so quietly and the page carries on. The log stores ids; names are
// looked up in the local stores and the member list. The entity's history is
// hidden by the server while it is archived (404), which reads as "no history".

type ActivityFeedProps = {
    entityType: 'ticket' | 'document'
    /** From the URL; may be a temporary id until the server has the row. */
    entityId: string
    /** The signed-in account, said as "You". */
    accountId: string
}

function merge(held: ActivityEntry[], incoming: ActivityEntry[]): ActivityEntry[] {
    const byId = new Map<string, ActivityEntry>()
    for (const entry of [...held, ...incoming]) if (!byId.has(entry.id)) byId.set(entry.id, entry)
    return [...byId.values()].toSorted((a, b) => b.created_at.localeCompare(a.created_at))
}

export function ActivityFeed(props: ActivityFeedProps) {
    const [entries, setEntries] = createSignal<ActivityEntry[]>([])
    const [next, setNext] = createSignal<string | null>(null)
    const [loaded, setLoaded] = createSignal(false)
    const [problem, setProblem] = createSignal(false)
    const [busy, setBusy] = createSignal(false)
    // Aspect type names by id: not a synced entity, so asked for one at a time.
    const [aspectNames, setAspectNames] = createSignal<Record<string, string>>({})
    const asked = new Set<string>()
    let latest = 0

    const entityId = () => resolveId(props.entityId)

    onSettled(() => {
        void loadMembers()
    })

    async function loadAspectNames(list: ActivityEntry[]) {
        for (const entry of list) {
            const id = entry.kind === 'aspect_type_changed' ? entry.summary_after : null
            if (id === null || asked.has(id)) continue
            asked.add(id)
            const got = await getAspectType(id)
            if (got.ok) setAspectNames((known) => ({ ...known, [id]: got.data.name }))
        }
    }

    async function reload(id: string, first: boolean) {
        const ticket = ++latest
        const got = await listActivity(props.entityType, id)
        if (ticket !== latest) return
        setLoaded(true)
        if (!got.ok) {
            // A refusal (archived, gone) is an empty history; only a missing connection is a problem.
            setProblem(got.code === 'network' || got.code === 'unknown')
            return
        }
        setProblem(false)
        setEntries((held) => merge(held, got.data.items))
        if (first || next() === null) setNext(got.data.next)
        void loadAspectNames(got.data.items)
    }

    async function more() {
        const cursor = next()
        if (cursor === null || busy()) return
        setBusy(true)
        const id = untrack(entityId)
        const got = await listActivity(props.entityType, id, cursor)
        setBusy(false)
        if (!got.ok) {
            setProblem(true)
            return
        }
        setEntries((held) => merge(held, got.data.items))
        setNext(got.data.next)
        void loadAspectNames(got.data.items)
    }

    createEffect(
        () => (isTempId(entityId()) ? null : entityId()),
        (id) => {
            setEntries([])
            setNext(null)
            setLoaded(false)
            if (!id) return
            void reload(id, true)
            const shown = () => {
                if (document.visibilityState !== 'hidden') void reload(id, false)
            }
            document.addEventListener('visibilitychange', shown)
            const off = onActivityEvent((entry) => {
                if (entry.entity_id !== id || entry.entity_type !== props.entityType) return
                setEntries((held) => merge(held, [entry]))
                void loadAspectNames([entry])
            })
            onCleanup(() => {
                document.removeEventListener('visibilitychange', shown)
                off()
            })
        },
    )

    const names = (): Names => ({
        me: props.accountId,
        person: (id) => memberName(id),
        status: (id) => sync.statuses.find((s) => s.id === id)?.name,
        epic: (id) => sync.epics.find((e) => e.id === id)?.name,
        label: (id) => sync.labels.find((l) => l.id === id)?.name,
        milestone: (id) => sync.milestones.find((m) => m.id === id)?.name,
        aspectType: (id) => aspectNames()[id],
    })

    return (
        <section class="activity" aria-labelledby="activity-title">
            <h2 id="activity-title" class="t-section">
                Activity
            </h2>
            <Show when={entries().length > 0}>
                <ol class="activity__list">
                    <For each={entries()} keyed={(entry) => entry.id}>
                        {(entry) => (
                            <li class="activity__item t-meta" data-activity-kind={entry().kind}>
                                {describe(entry(), names())} · <RelativeTime at={entry().created_at} />
                            </li>
                        )}
                    </For>
                </ol>
            </Show>
            <Show when={loaded() && entries().length === 0 && !problem()}>
                <p class="activity__none t-meta">Nothing has changed yet.</p>
            </Show>
            <Show when={problem()}>
                <p class="activity__none t-meta">The history is not available right now. It needs a connection.</p>
            </Show>
            <Show when={next() !== null}>
                <div>
                    <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void more()}>
                        Show earlier
                    </Button>
                </div>
            </Show>
        </section>
    )
}
