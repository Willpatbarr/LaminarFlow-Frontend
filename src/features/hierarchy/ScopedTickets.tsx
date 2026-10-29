import { createMemo, For, Show } from 'solid-js'

import { Table } from '@/components/ui/Table'
import { statusesForProject, sync, type Ticket } from '@/sync'

import { FIELDS, fieldLabel, visibleColumns, type ListViewConfig } from '../tickets/listView/config'
import { matches, sortTickets, type Lookups } from '../tickets/listView/evaluate'
import { TicketRow } from '../tickets/components/TicketRow'
import type { Viewer } from '../tickets/viewer'
import { progressOf } from './kinds'

type ScopedTicketsProps = {
    projectId: string
    /** From `scopedTickets`. */
    tickets: Ticket[]
    /** Which columns: the ticket list's own view config. */
    config: ListViewConfig
    viewer: Viewer
    /** Said when no ticket is filed here. Not a warning: an empty epic is normal. */
    empty: string
}

/** The tickets of a project that a list view config selects, and how many of them are done. */
export function scopedTickets(projectId: () => string, config: () => ListViewConfig) {
    const lookups = (): Lookups => ({
        statuses: statusesForProject(projectId()),
        epics: sync.epics.filter((row) => row.project_id === projectId()),
        milestones: sync.milestones.filter((row) => row.project_id === projectId()),
        sprints: sync.sprints.filter((row) => row.project_id === projectId()),
        labels: [],
    })
    return createMemo(() =>
        sortTickets(
            sync.tickets.filter((ticket) => ticket.project_id === projectId() && matches(ticket, config().filter)),
            config().sort,
            lookups(),
        ),
    )
}

export function doneStatusIds(projectId: string): Set<string> {
    return new Set(statusesForProject(projectId).filter((status) => status.category === 'done').map((status) => status.id))
}

export function progressFor(projectId: string, tickets: { status_id: string | null }[]) {
    return progressOf(tickets, doneStatusIds(projectId))
}

// The ticket list's rows and columns (LAM-106), over the tickets one config
// selects. Everything is read from the local store, so it answers at once and
// offline, and a ticket created, moved or archived elsewhere shows here as it
// does on the list.
export function ScopedTickets(props: ScopedTicketsProps) {
    const tickets = () => props.tickets
    const statuses = () => statusesForProject(props.projectId)
    const columns = () => visibleColumns(props.config)
    const template = () => [...columns().map((field) => FIELDS[field].width), '12px', '124px'].join(' ')
    const headers = () => [...columns().map((field) => (field === 'assignee' ? '' : fieldLabel(field))), '', '']

    return (
        <Show when={tickets().length > 0} fallback={<p class="t-body hierarchy__empty">{props.empty}</p>}>
            <Table columns={headers()} template={template()}>
                <For each={tickets()}>
                    {(ticket) => (
                        <TicketRow
                            ticket={ticket}
                            status={statuses().find((status) => status.id === ticket.status_id) ?? null}
                            statuses={statuses()}
                            viewer={props.viewer}
                            columns={columns().filter((field) => field !== 'title')}
                        />
                    )}
                </For>
            </Table>
        </Show>
    )
}
