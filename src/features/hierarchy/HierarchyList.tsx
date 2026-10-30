import { useNavigate } from '@solidjs/router'
import { createSignal, For, Show } from 'solid-js'

import { denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Select } from '@/components/ui/Select'
import { session } from '@/features/auth'
import {
    currentProject,
    epicsForProject,
    isLoading,
    milestonesForProject,
    selectProject,
    sprintsForProject,
    sync,
} from '@/sync'

import { doneStatusIds } from './ScopedTickets'
import { NewHierarchyDialog } from './NewHierarchyDialog'
import { formatDay, groupSprints, KINDS, localToday, progressOf, type Kind } from './kinds'
import './hierarchy.css'
import '../tickets/components/tickets.css'

const itemsFor = (kind: Kind, projectId: string) =>
    kind === 'epic' ? epicsForProject(projectId) : kind === 'sprint' ? sprintsForProject(projectId) : milestonesForProject(projectId)

// /epics, /sprints, /milestones: every one of the picked project's, to open or
// to make. An empty list is a fact about the project, not a problem to fix.
export function HierarchyList(props: { kind: Kind }) {
    const info = () => KINDS[props.kind]
    const navigate = useNavigate()
    const [creating, setCreating] = createSignal(false)
    const busy = () => session.status === 'unknown' || isLoading()
    const title = () => info().plural[0].toUpperCase() + info().plural.slice(1)

    return (
        <section class="tickets" aria-busy={busy() ? 'true' : undefined}>
            <header class="tickets__header">
                <h1 class="t-screen-title">{title()}</h1>
                <Show when={!busy() && sync.projects.length > 1}>
                    <div class="tickets__picker">
                        <Select
                            label="Project"
                            value={currentProject()?.id ?? ''}
                            options={sync.projects
                                .toSorted((a, b) => a.name.localeCompare(b.name))
                                .map((project) => ({ value: project.id, label: project.name }))}
                            onChange={(id) => void selectProject(id)}
                        />
                    </div>
                </Show>
                <div class="tickets__actions">
                    <Button disabled={busy() || !currentProject()} disabledReason={denial('ticket:write', 'create this')} onClick={() => setCreating(true)}>
                        New {info().singular}
                    </Button>
                </div>
            </header>
            <Show when={busy()}>
                <p class="visually-hidden" role="status">
                    Loading {info().plural}…
                </p>
            </Show>
            <Show when={!busy() && currentProject()}>
                {(project) => (
                    <>
                        <Show
                            when={itemsFor(props.kind, project().id).length > 0}
                            fallback={
                                <div class="tickets__empty">
                                    <p class="t-section">No {info().plural} in {project().name} yet</p>
                                    <p class="t-body">Tickets do not need one. Make one with “New {info().singular}” when you want to group work.</p>
                                </div>
                            }
                        >
                            <Show
                                when={props.kind === 'sprint'}
                                fallback={<ItemList label={title()} kind={props.kind} projectId={project().id} items={itemsFor(props.kind, project().id)} />}
                            >
                                <SprintGroupsView projectId={project().id} items={itemsFor('sprint', project().id)} />
                            </Show>
                        </Show>
                        <Show when={creating()}>
                            <NewHierarchyDialog
                                kind={props.kind}
                                projectId={project().id}
                                onCreated={(row) => navigate(`${info().path}/${row.id}`)}
                                onClose={() => setCreating(false)}
                            />
                        </Show>
                    </>
                )}
            </Show>
        </section>
    )
}

type Item = { id: string; name: string }

function ItemList(props: { label: string; kind: Kind; projectId: string; items: Item[] }) {
    return (
        <ul class="hierarchy__list" aria-label={props.label}>
            <For each={props.items} keyed={(item) => item.id}>
                {(item) => (
                    <li class="hierarchy__item">
                        <a class="t-body" href={`${KINDS[props.kind].path}/${item().id}`}>
                            {item().name}
                        </a>
                        <span class="hierarchy__meta t-meta">
                            <Summary kind={props.kind} id={item().id} projectId={props.projectId} row={item()} />
                        </span>
                    </li>
                )}
            </For>
        </ul>
    )
}

const PAST_KEY = 'lf-sprints-past-open'
const readPastOpen = () => {
    try {
        return localStorage.getItem(PAST_KEY) === '1'
    } catch {
        return false
    }
}
const writePastOpen = (open: boolean) => {
    try {
        localStorage.setItem(PAST_KEY, open ? '1' : '0')
    } catch {
        // Not remembered: the group still works.
    }
}

// Sprints by date: Current, Upcoming, No dates, and Past, which is collapsed to
// a count by default (collapsed, never hidden) and remembered per device.
function SprintGroupsView(props: { projectId: string; items: (Item & { start_date?: string | null; end_date?: string | null })[] }) {
    const groups = () => groupSprints(props.items, localToday())
    const [pastOpen, setPastOpen] = createSignal(readPastOpen())
    const toggle = () => {
        const next = !pastOpen()
        setPastOpen(next)
        writePastOpen(next)
    }
    const plain = [
        ['Current', () => groups().current],
        ['Upcoming', () => groups().upcoming],
        ['No dates', () => groups().undated],
    ] as const
    return (
        <>
            <For each={plain}>
                {([heading, rows]) => (
                    <Show when={rows().length > 0}>
                        <section class="hierarchy__group" aria-labelledby={`sprints-${heading}`}>
                            <h2 class="t-section" id={`sprints-${heading}`}>
                                {heading}
                            </h2>
                            <ItemList label={heading} kind="sprint" projectId={props.projectId} items={rows()} />
                        </section>
                    </Show>
                )}
            </For>
            <Show when={groups().past.length > 0}>
                <section class="hierarchy__group">
                    <h2 class="t-section">
                        <button
                            type="button"
                            class="hierarchy__group-toggle"
                            aria-expanded={pastOpen() ? 'true' : 'false'}
                            aria-controls="sprints-past"
                            onClick={toggle}
                        >
                            {pastOpen() ? '▾' : '▸'} Past ({groups().past.length})
                        </button>
                    </h2>
                    <div id="sprints-past">
                        <Show when={pastOpen()}>
                            <ItemList label="Past" kind="sprint" projectId={props.projectId} items={groups().past} />
                        </Show>
                    </div>
                </section>
            </Show>
        </>
    )
}

function Summary(props: { kind: Kind; id: string; projectId: string; row: object }) {
    const row = () => props.row as { start_date?: string | null; end_date?: string | null; target_date?: string | null }
    const tickets = () =>
        sync.tickets.filter(
            (ticket) =>
                ticket.project_id === props.projectId &&
                (props.kind === 'epic'
                    ? ticket.epic_id === props.id
                    : props.kind === 'milestone'
                      ? ticket.milestone_id === props.id
                      : ticket.sprint_ids.includes(props.id)),
        )
    const progress = () => progressOf(tickets(), doneStatusIds(props.projectId))
    return (
        <>
            <Show when={props.kind === 'sprint' && (row().start_date || row().end_date)}>
                <span>
                    {formatDay(row().start_date ?? null) || '…'} – {formatDay(row().end_date ?? null) || '…'}
                </span>
            </Show>
            <Show when={props.kind === 'milestone' && row().target_date}>
                <span>Target {formatDay(row().target_date ?? null)}</span>
            </Show>
            <span>
                {progress().total === 0
                    ? 'No tickets'
                    : `${progress().done} of ${progress().total} ${progress().total === 1 ? 'ticket' : 'tickets'} done`}
            </span>
            <span class="hierarchy__row-bar">
                <ProgressBar
                    done={progress().done}
                    total={progress().total}
                    label={`Progress of ${(props.row as { name?: string }).name ?? props.kind}`}
                    valueText={`${progress().done} of ${progress().total} ${progress().total === 1 ? 'ticket' : 'tickets'} done`}
                />
            </span>
        </>
    )
}
