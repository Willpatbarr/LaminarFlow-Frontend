import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { sync, ticketSyncState, updateTicket } from '@/sync'

import { matches } from '../tickets/listView/evaluate'
import type { FilterGroup } from '../tickets/listView/config'
import { serverMatches } from '../tickets/listView/serverRun'

const SHOWN = 20

// "Add tickets": search the whole project for tickets that are not in the
// sprint yet, and add them one at a time. A ticket can be in several sprints
// and in an epic at the same time, so nothing here looks at epics.
//
// The search is run twice, as the ticket list's filter is: here first, over the
// rows this device holds, so it answers at once and offline; then on the server
// (POST /tickets/list), whose answer is used for every ticket the server has
// seen without unsent changes. If the server cannot be asked, the local answer
// stands.
export function AddTicketsToSprint(props: { sprintId: string; projectId: string }) {
    const [query, setQuery] = createSignal('')
    const text = () => query().trim()
    const filter = (): FilterGroup | undefined =>
        text() ? { op: 'and', conditions: [{ field: 'title', op: 'contains', value: text() }] } : undefined

    const [server, setServer] = createSignal<{ ask: string; ids: Set<string> } | null>(null)
    createEffect(
        () => (text() ? JSON.stringify([props.projectId, text()]) : null),
        (ask) => {
            if (!ask) return
            let current = true
            const [projectId, typed] = JSON.parse(ask) as [string, string]
            const group: FilterGroup = { op: 'and', conditions: [{ field: 'title', op: 'contains', value: typed }] }
            void serverMatches(projectId, group).then((ids) => {
                if (current && ids) setServer({ ask, ids })
            })
            return () => {
                current = false
            }
        },
    )

    const found = createMemo(() => {
        const ask = text() ? JSON.stringify([props.projectId, text()]) : null
        const heard = server()?.ask === ask ? server()!.ids : null
        return sync.tickets
            .filter((ticket) => ticket.project_id === props.projectId && !ticket.sprint_ids.includes(props.sprintId))
            .filter((ticket) => {
                const local = matches(ticket, filter())
                if (!heard || ticketSyncState(ticket.id) !== 'synced') return local
                return heard.has(ticket.id)
            })
            .toSorted((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    })

    return (
        <section class="hierarchy__add" aria-label="Add tickets">
            <h2 class="t-section">Add tickets</h2>
            <Input label="Search this project’s tickets" value={query()} onInput={setQuery} />
            <ul class="hierarchy__results" aria-label="Tickets that can be added">
                <For each={found().slice(0, SHOWN)} keyed={(ticket) => ticket.id}>
                    {(ticket) => (
                        <li class="hierarchy__result">
                            <span class="t-body">{ticket().title || 'Untitled'}</span>
                            <Button
                                variant="secondary"
                                size="sm"
                                aria-label={`Add ${ticket().title || 'Untitled'} to this sprint`}
                                onClick={() =>
                                    void updateTicket(ticket().id, { sprint_ids: [...ticket().sprint_ids, props.sprintId] })
                                }
                            >
                                Add
                            </Button>
                        </li>
                    )}
                </For>
            </ul>
            <Show when={found().length === 0}>
                <p class="t-meta hierarchy__empty">
                    {text() ? 'No ticket matches.' : 'Every ticket in this project is already in the sprint.'}
                </p>
            </Show>
            <Show when={found().length > SHOWN}>
                <p class="t-meta hierarchy__empty">Showing {SHOWN} of {found().length}. Type to narrow it down.</p>
            </Show>
        </section>
    )
}
