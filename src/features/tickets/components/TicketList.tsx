import { useLocation, useNavigate } from '@solidjs/router'
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js'

import { denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { SkeletonBox, SkeletonLine, type SkeletonLength } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { Table, TableHeader } from '@/components/ui/Table'
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
import { freezeOrder, type Placed } from '../listView/freezeOrder'
import { buildGroups } from '../listView/group'
import { serverMatches } from '../listView/serverRun'
import { VIEW_PARAM, viewUrl } from '../savedViews/savedView'
import { hueFor, isStarted } from '../statusLook'
import { tickets as ticketCount } from '@/features/syncstatus/components/plural'
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint'
import { useScope, useShortcut } from '@/features/shortcuts/registry'
import type { Viewer } from '../viewer'
import { FirstRunSetup } from './FirstRunSetup'
import { ListControls } from './ListControls'
import { NewTicketDialog } from './NewTicketDialog'
import { SavedViewBar } from './SavedViewBar'
import { TicketDetail } from './TicketDetail'
import { TicketRow } from './TicketRow'
import { ViewSwitch } from './ViewSwitch'
import { Icon } from '@/components/ui/icons/Icon'
import './tickets.css'

type TicketListProps = {
    viewer: Viewer
    /** Force the placeholder, whatever the store says. The route passes it while
     *  the session is still unknown; the store's own `isLoading()` covers the
     *  first hydration. */
    loading?: boolean
    /** The title's level. A page that already has its own h1 (the project page) passes 'h2'. */
    heading?: 'h1' | 'h2'
}

// "Tickets", at the level the page needs (one h1 per page).
function ListTitle(props: { heading?: 'h1' | 'h2' }) {
    return (
        <Show when={props.heading === 'h2'} fallback={<h1 class="t-screen-title">Tickets</h1>}>
            <h2 class="t-screen-title">Tickets</h2>
        </Show>
    )
}

// Title · status · assignee · unsynced marker. The loading placeholder's
// columns; the list proper builds its own from the view's `columns`.
const COLUMNS = 'minmax(0, 1fr) 132px 72px 12px 64px'

// The chosen columns, then the unsynced marker and the room the row's buttons
// take. Shared by every group so the columns line up down the page.
const templateFor = (columns: string[]) => [...columns.map((field) => FIELDS[field].width), '12px', '64px'].join(' ')
const headersFor = (columns: string[]) => [...columns.map((field) => fieldLabel(field)), '', '']

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
                    <LoadingTickets heading={props.heading} />
                </Match>
                <Match when={loadFailed()}>
                    <ListTitle heading={props.heading} />
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
                    {(project) => <ProjectTickets project={project()} viewer={props.viewer} heading={props.heading} />}
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
function LoadingTickets(props: { heading?: 'h1' | 'h2' }) {
    return (
        <>
            <header class="tickets__header">
                <ListTitle heading={props.heading} />
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
                <Table columns={['Title', 'Status', 'Assignee', '', '']} template={COLUMNS}>
                    <For each={TITLE_WIDTHS}>{(width) => <TicketRow loading titleWidth={width} />}</For>
                </Table>
            </div>
        </>
    )
}

type ProjectTicketsProps = {
    project: Project
    viewer: Viewer
    heading?: 'h1' | 'h2'
}

function ProjectTickets(props: ProjectTicketsProps) {
    const [creating, setCreating] = createSignal(false)
    const navigate = useNavigate()
    const location = useLocation()
    // The side panel: `/?ticket=<id>`. Plain data in the address, so a reload or
    // a shared link opens the same panel; the row's own href still goes to the
    // full page (open in a new tab, or with a modifier key).
    const openId = () => new URLSearchParams(location.search).get('ticket') || null
    // `view=<id>`: the saved view this list was opened from (LAM-118). Kept like
    // the panel is, so a change to the list does not forget where it came from.
    const viewId = () => new URLSearchParams(location.search).get(VIEW_PARAM) || null

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
    // A new ticket should be in its place when the dialog closes.
    const openDialog = () => {
        thaw()
        setCreating(true)
    }
    // A view change is not a place to go back to, so it replaces the entry.
    function writeView(config: ListViewConfig, collapsed: string[]) {
        const params = toSearch(config, collapsed)
        const ticket = openId()
        if (ticket) params.set('ticket', ticket)
        const saved = viewId()
        if (saved) params.set(VIEW_PARAM, saved)
        go(params, true)
    }
    function belongTo(id: string) {
        const params = new URLSearchParams(location.search)
        params.set(VIEW_PARAM, id)
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

    // Keys for this screen, declared in the shortcut registry (LAM-124): `C`
    // opens this list's own new-ticket dialog (taking over the shell's
    // fallback), `J` and `K` walk the rows. The listener has already ruled out
    // fields, open dialogs and Ctrl/Cmd/Alt.
    useScope('list')
    useShortcut('ticket.new', () => openDialog())
    useShortcut('list.next', () => stepRow(1))
    useShortcut('list.previous', () => stepRow(-1))

    let root: HTMLDivElement | undefined
    // Moves focus to the next (or previous) ticket row; from nowhere in the
    // list, to the first (or last). Enter on the row then opens it like a click.
    function stepRow(by: 1 | -1) {
        const rows = [...(root?.querySelectorAll<HTMLElement>('a.table__row') ?? [])]
        if (rows.length === 0) return
        const at = rows.findIndex((row) => row === document.activeElement)
        const next = at === -1 ? (by === 1 ? 0 : rows.length - 1) : Math.max(0, Math.min(at + by, rows.length - 1))
        rows[next].focus()
    }

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
    const [answer, setAnswer] = createSignal<{
        ask: string
        ids: Set<string>
    } | null>(null)
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

    const sorted = createMemo(() => {
        const f = filter()
        const server = answer()?.ask === asked() ? answer()!.ids : null
        const rows = projectTickets().filter((ticket) => {
            const local = matches(ticket, f)
            if (!f || !server || ticketSyncState(ticket.id) !== 'synced') return local
            return server.has(ticket.id)
        })
        return sortTickets(rows, view().config.sort, lookups())
    })

    // The order stays put while the user is using the list (LAM-145). Using it
    // means the pointer is over the rows, or focus is in them. The freeze ends
    // when both are gone, and a sort, filter, grouping or project change ends it
    // at once: those are the user asking for a new order.
    const [pointerIn, setPointerIn] = createSignal(false)
    const [focusIn, setFocusIn] = createSignal(false)
    const frozen = () => pointerIn() || focusIn()
    const thaw = () => {
        setPointerIn(false)
        setFocusIn(false)
    }
    // A touch has no pointer to leave, so only the mouse and pen freeze by
    // position. Focus protects a touch user's tapped row.
    const pointerOver = (event: PointerEvent) => {
        if (event.pointerType !== 'touch') setPointerIn(true)
    }
    let rows: HTMLDivElement | undefined
    const focusWithin = () => !!rows && rows.contains(document.activeElement)
    // The signals above are set by events, and an event can be missed: the
    // pointer leaves the window, a focused row is removed, the tab is hidden.
    // While frozen, look at the real state every half second and let go when
    // neither holds, so the list cannot stay frozen.
    createEffect(frozen, (isFrozen) => {
        if (!isFrozen) return
        const timer = setInterval(() => {
            if (document.hidden || !rows) return thaw()
            const hovered = rows.matches(':hover')
            const focused = focusWithin()
            if (pointerIn() && !hovered) setPointerIn(false)
            if (focusIn() && !focused) setFocusIn(false)
        }, 500)
        return () => clearInterval(timer)
    })
    // The pointer leaving the window sends no pointerleave to the rows in every
    // browser: a mouseout with nowhere to go says it.
    const onWindowOut = (event: MouseEvent) => {
        if (event.relatedTarget === null) setPointerIn(false)
    }
    const onWindowBlur = () => setPointerIn(false)
    document.addEventListener('mouseout', onWindowOut)
    window.addEventListener('blur', onWindowBlur)
    onCleanup(() => {
        document.removeEventListener('mouseout', onWindowOut)
        window.removeEventListener('blur', onWindowBlur)
    })
    createEffect(
        () => JSON.stringify([props.project.id, view().config]),
        () => thaw(),
    )

    // The last thing shown. Read when the list freezes, so it freezes on exactly
    // what the user was looking at.
    let lastShown: Placed[] = []
    const display = createMemo(() => {
        const result = freezeOrder(
            lastShown,
            sorted(),
            (id) => projectTickets().find((ticket) => ticket.id === id),
            frozen(),
        )
        lastShown = result.rows
        return result
    })
    const placedRows = () => display().rows
    const rowById = createMemo(() => new Map(placedRows().map((row) => [row.id, row])))
    const groups = createMemo(() => {
        return buildGroups(
            placedRows().map((row) => row.placed),
            view().config.group,
            lookups(),
            props.viewer.accountId,
        )
    })
    const columns = createMemo(() => visibleColumns(view().config))
    const statusOf = (statusId: string | null) => statuses().find((status) => status.id === statusId) ?? null

    return (
        <div
            class="tickets__stack"
            ref={(el) => {
                root = el
                el.addEventListener('click', openPanel, true)
            }}
        >
            <header class="tickets__header">
                <ListTitle heading={props.heading} />
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
                            <ViewSwitch current="list" projectId={props.project.id} boardId={board().id} filter={view().config.filter} />
                        )}
                    </Show>
                    <a class="button button--ghost" href={`/teams/${props.project.team_id}/settings`}>
                        Edit statuses
                    </a>
                    <Button onClick={() => openDialog()} disabledReason={denial('ticket:write', 'create tickets')}>
                        New ticket
                        <ShortcutHint id="ticket.new" />
                    </Button>
                </div>
            </header>

            <SavedViewBar
                layout="list"
                config={view().config}
                viewId={viewId()}
                accountId={props.viewer.accountId}
                teamId={props.project.team_id}
                projectId={props.project.id}
                onSaved={(saved) => belongTo(saved.id)}
                onRevert={(saved) => navigate(viewUrl(saved), { replace: true })}
            />

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
                    <div
                        class="tickets__rows"
                        ref={(el) => {
                            rows = el
                        }}
                        onPointerEnter={pointerOver}
                        onPointerMove={pointerOver}
                        onPointerDown={pointerOver}
                        onPointerLeave={() => setPointerIn(false)}
                        onFocusIn={() => setFocusIn(true)}
                        onFocusOut={(event) => {
                            const to = event.relatedTarget
                            if (!(to instanceof Node && rows?.contains(to))) setFocusIn(false)
                        }}
                    >
                        <TableHeader columns={headersFor(columns())} template={templateFor(columns())} />
                        <For each={groups()} keyed={(group) => group.key}>
                            {(group) => (
                                <section class="tickets__group" aria-label={group().title}>
                                    <Show when={view().config.group !== undefined}>
                                        <h2 class="tickets__group-title">
                                            <button
                                                type="button"
                                                class="tickets__group-toggle"
                                                aria-expanded={
                                                    view().collapsed.includes(group().key) ? 'false' : 'true'
                                                }
                                                aria-label={`${group().title}, ${ticketCount(group().tickets.length)}`}
                                                onClick={() => toggleGroup(group().key)}
                                            >
                                                <span class="tickets__chevron" aria-hidden="true">
                                                    <Icon name={view().collapsed.includes(group().key) ? 'caret-right' : 'caret-down'} size={16} />
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
                                        <Table
                                            columns={headersFor(columns())}
                                            template={templateFor(columns())}
                                            header={false}
                                        >
                                            <For each={group().tickets} keyed={(ticket) => ticket.id}>
                                                {(placed) => (
                                                    <Show when={rowById().get(placed().id)}>
                                                        {(row) => (
                                                            <TicketRow
                                                                ticket={row().ticket}
                                                                gone={row().gone}
                                                                status={statusOf(row().ticket.status_id)}
                                                                statuses={statuses()}
                                                                viewer={props.viewer}
                                                                columns={columns().filter((field) => field !== 'title')}
                                                            />
                                                        )}
                                                    </Show>
                                                )}
                                            </For>
                                        </Table>
                                    </Show>
                                </section>
                            )}
                        </For>
                        <Show when={display().held > 0}>
                            <p class="tickets__held t-meta" role="status">
                                {ticketCount(display().held)} new or changed —{' '}
                                <button type="button" class="tickets__held-button" onClick={thaw}>
                                    refresh order
                                </button>
                            </p>
                        </Show>
                    </div>
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
