import { useLocation, useNavigate } from '@solidjs/router'
import { createEffect, createMemo, createSignal, For, Match, onSettled, Show, Switch } from 'solid-js'

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
    labelsForProject,
    statusesForProject,
    sync,
    ticketSyncState,
    type Project,
} from '@/sync'

import {
    FIELDS,
    fieldLabel,
    fromSearch,
    toSearch,
    visibleColumns,
    type FilterGroup,
    type ListViewConfig,
} from '../listView/config'
import { matches, sortTickets, type Lookups } from '../listView/evaluate'
import { buildGroups } from '../listView/group'
import { serverMatches } from '../listView/serverRun'
import { hueFor, isStarted } from '../statusLook'
import type { Viewer } from '../viewer'
import { FirstRunSetup } from './FirstRunSetup'
import { ListControls } from './ListControls'
import { NewTicketDialog } from './NewTicketDialog'
import { TicketDetail } from './TicketDetail'
import { TicketRow } from './TicketRow'
import './tickets.css'

type TicketListProps = {
    viewer: Viewer
    /** Force the placeholder, whatever the store says. The route passes it while
     *  the session is still unknown; the store's own `isLoading()` covers the
     *  first hydration. */
    loading?: boolean
}

// Title · status · assignee · unsynced marker. The loading placeholder's
// columns; the list proper builds its own from the view's `columns`.
const COLUMNS = 'minmax(0, 1fr) 132px 20px 12px 124px'

// The chosen columns, then the unsynced marker and the room the row's buttons
// take. Shared by every group so the columns line up down the page.
const templateFor = (columns: string[]) => [...columns.map((field) => FIELDS[field].width), '12px', '124px'].join(' ')
const headersFor = (columns: string[]) => [
    ...columns.map((field) => (field === 'assignee' ? '' : fieldLabel(field))),
    '',
    '',
]

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
        <section class="tickets tickets--list" aria-busy={busy() ? 'true' : undefined}>
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
                    <For each={TITLE_WIDTHS}>{(width) => <TicketRow loading titleWidth={width} />}</For>
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
    const navigate = useNavigate()
    const location = useLocation()
    // The side panel: `/?ticket=<id>`. Plain data in the address, so a reload or
    // a shared link opens the same panel; the row's own href still goes to the
    // full page (open in a new tab, or with a modifier key).
    const openId = () => new URLSearchParams(location.search).get('ticket') || null

    // The list's view lives in the same query string (filter, sort, group,
    // columns, collapsed - see listView/config.ts), so opening or closing the
    // panel must keep it, and changing the view must keep the panel.
    const view = createMemo(() => fromSearch(new URLSearchParams(location.search)))
    const go = (params: URLSearchParams, replace: boolean) => {
        const query = params.toString()
        navigate(query ? `/?${query}` : '/', { replace })
    }
    function showTicket(id: string | null) {
        const params = new URLSearchParams(location.search)
        if (id) params.set('ticket', id)
        else params.delete('ticket')
        go(params, false)
    }
    const closePanel = () => showTicket(null)
    // A view change is not a place to go back to, so it replaces the entry.
    function writeView(config: ListViewConfig, collapsed: string[]) {
        const params = toSearch(config, collapsed)
        const ticket = openId()
        if (ticket) params.set('ticket', ticket)
        go(params, true)
    }
    const setConfig = (config: ListViewConfig) =>
        writeView(config, config.group === view().config.group ? view().collapsed : [])
    const toggleGroup = (key: string) => {
        const open = view().collapsed
        writeView(view().config, open.includes(key) ? open.filter((k) => k !== key) : [...open, key])
    }

    // Captured before the router's own click handling sees the link, so a plain
    // left click opens the panel instead of leaving the list.
    function openPanel(event: MouseEvent) {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        )
            return
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a.table__row') : null
        const id = /^\/tickets\/([^/?#]+)$/.exec(link?.getAttribute('href') ?? '')?.[1]
        if (!id) return
        event.preventDefault()
        showTicket(id)
    }

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

    const lookups = createMemo<Lookups>(() => ({
        statuses: statuses(),
        epics: sync.epics.filter((row) => row.project_id === props.project.id),
        milestones: sync.milestones.filter((row) => row.project_id === props.project.id),
        sprints: sync.sprints.filter((row) => row.project_id === props.project.id),
        labels: labelsForProject(props.project.id),
    }))

    const projectTickets = createMemo(() => sync.tickets.filter((ticket) => ticket.project_id === props.project.id))
    const filter = () => view().config.filter

    // The filter is run twice. Locally first, over the rows this device holds,
    // so the list answers at once and offline. Then on the server
    // (POST /tickets/list); once it has answered, the list shows what the
    // server says for every ticket the server has seen. A ticket with unsent
    // changes keeps the local answer, because the server has not heard about
    // its new values. If the server cannot be asked, the local answer stands.
    // Asked again when the project's tickets change, so a live edit that makes
    // a ticket match (or stop matching) is not judged by a stale answer.
    const [answer, setAnswer] = createSignal<{ ask: string; ids: Set<string> } | null>(null)
    const asked = () => (filter() ? JSON.stringify([props.project.id, filter()]) : null)
    createEffect(
        () => {
            const ask = asked()
            if (!ask) return null
            const rows = projectTickets()
            const latest = rows.reduce((newest, t) => (t.updated_at > newest ? t.updated_at : newest), '')
            return JSON.stringify([ask, rows.length, latest])
        },
        (key) => {
            if (!key) return
            const [ask] = JSON.parse(key) as [string]
            const [projectId, group] = JSON.parse(ask) as [string, FilterGroup]
            let current = true
            void serverMatches(projectId, group).then((ids) => {
                if (current && ids) setAnswer({ ask, ids })
            })
            return () => {
                current = false
            }
        },
    )

    const shown = createMemo(() => {
        const f = filter()
        const server = answer()?.ask === asked() ? answer()!.ids : null
        const rows = projectTickets().filter((ticket) => {
            const local = matches(ticket, f)
            if (!f || !server || ticketSyncState(ticket.id) !== 'synced') return local
            return server.has(ticket.id)
        })
        return sortTickets(rows, view().config.sort, lookups())
    })
    const groups = createMemo(() => buildGroups(shown(), view().config.group, lookups(), props.viewer.accountId))
    const columns = createMemo(() => visibleColumns(view().config))
    const statusOf = (statusId: string | null) => statuses().find((status) => status.id === statusId) ?? null

    return (
        <div
            ref={(el) => {
                el.addEventListener('click', openPanel, true)
            }}
        >
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
                when={projectTickets().length > 0}
                fallback={
                    <div class="tickets__empty">
                        <p class="t-section">No tickets in {props.project.name} yet</p>
                        <p class="t-body">Create the first one with “New ticket”.</p>
                    </div>
                }
            >
                <ListControls
                    config={view().config}
                    onChange={setConfig}
                    project={props.project}
                    viewer={props.viewer}
                />
                <Show
                    when={groups().length > 0}
                    fallback={
                        <div class="tickets__empty">
                            <p class="t-section">No tickets match this filter</p>
                            <p class="t-body">Change or clear the filters to see more.</p>
                        </div>
                    }
                >
                    {/* Keyed by group: the group objects are rebuilt on every
                        change, and keying by reference would rebuild every row's
                        DOM with them. */}
                    <For each={groups()} keyed={(group) => group.key}>
                        {(group) => (
                            <section class="tickets__group" aria-label={group().title}>
                                <Show when={view().config.group !== undefined}>
                                    <h2 class="tickets__group-title">
                                        <button
                                            type="button"
                                            class="tickets__group-toggle"
                                            aria-expanded={view().collapsed.includes(group().key) ? 'false' : 'true'}
                                            aria-label={`${group().title}, ${group().tickets.length} tickets`}
                                            onClick={() => toggleGroup(group().key)}
                                        >
                                            <span class="tickets__chevron" aria-hidden="true">
                                                {view().collapsed.includes(group().key) ? '▸' : '▾'}
                                            </span>
                                            <Show
                                                when={view().config.group === 'status'}
                                                fallback={<span class="t-body">{group().title}</span>}
                                            >
                                                <Show
                                                    when={group().status}
                                                    fallback={<StatusPill label={group().title} hue="slate" />}
                                                >
                                                    {(status) => (
                                                        <StatusPill
                                                            label={status().name}
                                                            hue={hueFor(status().color)}
                                                            active={isStarted(status())}
                                                        />
                                                    )}
                                                </Show>
                                            </Show>
                                            <span class="tickets__count t-meta">{group().tickets.length}</span>
                                        </button>
                                    </h2>
                                </Show>
                                <Show when={!view().collapsed.includes(group().key)}>
                                    <Table columns={headersFor(columns())} template={templateFor(columns())}>
                                        <For each={group().tickets}>
                                            {(ticket) => (
                                                <TicketRow
                                                    ticket={ticket}
                                                    status={statusOf(ticket.status_id)}
                                                    statuses={statuses()}
                                                    viewer={props.viewer}
                                                    columns={columns().filter((field) => field !== 'title')}
                                                />
                                            )}
                                        </For>
                                    </Table>
                                </Show>
                            </section>
                        )}
                    </For>
                </Show>
            </Show>

            <Show when={creating()}>
                <NewTicketDialog
                    projectId={props.project.id}
                    statuses={statuses()}
                    statusId={statuses()[0]?.id ?? null}
                    onClose={() => setCreating(false)}
                />
            </Show>

            <Show when={openId()}>
                {(id) => (
                    <aside
                        class="ticket-panel"
                        aria-label="Ticket"
                        onKeyDown={(event) => {
                            // Not from a field: Escape there belongs to the field.
                            const field =
                                event.target instanceof Element && event.target.closest('input, textarea, select')
                            if (event.key === 'Escape' && !event.defaultPrevented && !field) closePanel()
                        }}
                    >
                        <TicketDetail id={id()} viewer={props.viewer} onClose={closePanel} />
                    </aside>
                )}
            </Show>
        </div>
    )
}
