import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { SkeletonBox, SkeletonLine, type SkeletonLength } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { Table } from '@/components/ui/Table'
import {
    boardsForProject,
    currentProject,
    isLoading,
    loadFailed,
    needsSetup,
    rehydrate,
    selectProject,
    statusesForProject,
    sync,
    type Project,
    type Status,
    type Ticket,
} from '@/sync'

import { hueFor, isStarted } from '../statusLook'
import type { Viewer } from '../viewer'
import { FirstRunSetup } from './FirstRunSetup'
import { NewTicketDialog } from './NewTicketDialog'
import { TicketRow } from './TicketRow'
import './tickets.css'

type TicketListProps = {
    viewer: Viewer
    /** Force the placeholder, whatever the store says. The route passes it while
     *  the session is still unknown; the store's own `isLoading()` covers the
     *  first hydration. */
    loading?: boolean
}

type Group = {
    /** Null is the "No status" group. */
    status: Status | null
    tickets: Ticket[]
}

// Title · status · assignee · unsynced marker. Shared by every group so the
// columns line up down the page.
const COLUMNS = 'minmax(0, 1fr) 132px 20px 12px 124px'

// Newest change first, so the ticket just created or edited is where the eye
// already is. The id breaks ties so the order never depends on how the
// database happened to return the rows.
function byRecency(a: Ticket, b: Ticket) {
    return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)
}

// The tickets screen. Everything it shows is read from the local store; the
// only thing it ever asks the network for directly is nothing at all.
//
// While loading it draws its own placeholder in the list's own layout - the
// same heading and button, the same group header over the same table rows -
// because it is the only thing that knows where those sit. The page does not
// rearrange when the tickets arrive.
export function TicketList(props: TicketListProps) {
    const busy = () => props.loading || isLoading()
    return (
        <section class="tickets" aria-busy={busy() ? 'true' : undefined}>
            <Switch>
                <Match when={busy()}>
                    <LoadingTickets />
                </Match>
                <Match when={loadFailed()}>
                    <h1 class="t-screen-title">Tickets</h1>
                    <p class="t-body" role="alert">
                        Your tickets could not be loaded. Check your connection and try again.
                    </p>
                    <div>
                        <Button variant="secondary" onClick={() => void rehydrate()}>
                            Try again
                        </Button>
                    </div>
                </Match>
                <Match when={needsSetup()}>
                    <FirstRunSetup viewer={props.viewer} />
                </Match>
                <Match when={currentProject()}>
                    {(project) => <ProjectTickets project={project()} viewer={props.viewer} />}
                </Match>
            </Switch>
        </section>
    )
}

// How much of the title column each placeholder row takes. Varied so the
// column does not read as one repeated bar.
const TITLE_WIDTHS: SkeletonLength[] = ['62%', '44%', '73%']

// The heading and the button stay: they are true before any data arrives. The
// button is disabled rather than hidden, so it does not appear a moment later,
// and there is no project to create a ticket in yet anyway.
function LoadingTickets() {
    return (
        <>
            <header class="tickets__header">
                <h1 class="t-screen-title">Tickets</h1>
                <div class="tickets__actions">
                    <Button disabled>New ticket</Button>
                </div>
            </header>
            {/* The one announcement. It is visually hidden: sighted users have
                the placeholder itself. */}
            <p class="visually-hidden" role="status">
                Loading tickets…
            </p>
            <div class="tickets__group" aria-hidden="true">
                <div class="tickets__group-title">
                    <SkeletonBox shape="pill" width="88px" height="21px" />
                    <SkeletonLine width="2ch" height="11px" />
                </div>
                <Table columns={['Title', 'Status', '', '', '']} template={COLUMNS}>
                    <For each={TITLE_WIDTHS}>
                        {(width) => <TicketRow loading titleWidth={width} />}
                    </For>
                </Table>
            </div>
        </>
    )
}

type ProjectTicketsProps = {
    project: Project
    viewer: Viewer
}

function ProjectTickets(props: ProjectTicketsProps) {
    const [creating, setCreating] = createSignal(false)

    const statuses = createMemo(() => statusesForProject(props.project.id))

    // `C` opens the new-ticket dialog from anywhere on the list, unless the
    // key is meant for something else: a field being typed in, a shortcut
    // (Ctrl/Cmd/Alt + C is copy), or a dialog that is already open.
    onSettled(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey) return
            if (event.defaultPrevented || event.repeat || creating()) return
            const target = event.target
            if (
                target instanceof HTMLElement &&
                (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"]'))
            ) {
                return
            }
            event.preventDefault()
            setCreating(true)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    // One group per status, in board order, then "No status" - which also
    // takes any ticket whose status is not one of this team's (deleted since).
    // Empty groups are left out: this is a list of tickets, not a board.
    const groups = createMemo<Group[]>(() => {
        const known = new Map<string, Ticket[]>(statuses().map((status) => [status.id, []]))
        const loose: Ticket[] = []
        for (const ticket of sync.tickets) {
            if (ticket.project_id !== props.project.id) continue
            const bucket = ticket.status_id ? known.get(ticket.status_id) : undefined
            ;(bucket ?? loose).push(ticket)
        }
        const all: Group[] = statuses().map((status) => ({
            status,
            tickets: known.get(status.id)!.sort(byRecency),
        }))
        all.push({ status: null, tickets: loose.sort(byRecency) })
        return all.filter((group) => group.tickets.length > 0)
    })

    return (
        <>
            <header class="tickets__header">
                <h1 class="t-screen-title">Tickets</h1>
                <Show when={sync.projects.length > 1}>
                    <div class="tickets__picker">
                        <Select
                            label="Project"
                            value={props.project.id}
                            options={sync.projects
                                .toSorted((a, b) => a.name.localeCompare(b.name))
                                .map((project) => ({ value: project.id, label: project.name }))}
                            onChange={(id) => void selectProject(id)}
                        />
                    </div>
                </Show>
                <div class="tickets__actions">
                    <Show when={boardsForProject(props.project.id)[0]}>
                        {(board) => (
                            <>
                                <a class="t-body" href={`/boards/${board().id}`}>
                                    Board
                                </a>{' '}
                            </>
                        )}
                    </Show>
                    <a class="t-body" href={`/teams/${props.project.team_id}/settings`}>
                        Edit statuses
                    </a>{' '}
                    <Button onClick={() => setCreating(true)}>New ticket</Button>
                </div>
            </header>

            <Show
                when={groups().length > 0}
                fallback={
                    <div class="tickets__empty">
                        <p class="t-section">No tickets in {props.project.name} yet</p>
                        <p class="t-body">Create the first one with “New ticket”.</p>
                    </div>
                }
            >
                {/* Keyed by status id: the group objects are rebuilt on every
                    change, and keying by reference would rebuild every row's
                    DOM with them. */}
                <For each={groups()} keyed={(group) => group.status?.id ?? 'none'}>
                    {(group) => (
                        <section
                            class="tickets__group"
                            aria-label={group().status?.name ?? 'No status'}
                        >
                            <h2 class="tickets__group-title">
                                <Show
                                    when={group().status}
                                    fallback={<StatusPill label="No status" hue="slate" />}
                                >
                                    {(status) => (
                                        <StatusPill
                                            label={status().name}
                                            hue={hueFor(status().color)}
                                            active={isStarted(status())}
                                        />
                                    )}
                                </Show>
                                <span class="tickets__count t-meta">{group().tickets.length}</span>
                            </h2>
                            <Table columns={['Title', 'Status', '', '', '']} template={COLUMNS}>
                                <For each={group().tickets}>
                                    {(ticket) => (
                                        <TicketRow
                                            ticket={ticket}
                                            status={group().status}
                                            statuses={statuses()}
                                            viewer={props.viewer}
                                        />
                                    )}
                                </For>
                            </Table>
                        </section>
                    )}
                </For>
            </Show>

            <Show when={creating()}>
                <NewTicketDialog
                    projectId={props.project.id}
                    statuses={statuses()}
                    statusId={statuses()[0]?.id ?? null}
                    onClose={() => setCreating(false)}
                />
            </Show>
        </>
    )
}
