import { useNavigate, useParams } from '@solidjs/router'
import { createEffect, createSignal, For, onSettled, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { can, session } from '@/features/auth'
import { ensureMembers, memberName } from '@/features/members/members'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { viewUrl } from '@/features/tickets/savedViews/savedView'
import {
    boardById,
    canEditSavedView,
    currentProject,
    deleteSavedView,
    isLoading,
    savedViewById,
    selectProject,
    sync,
    type SavedView,
} from '@/sync'

import { viewer } from './viewer'
import './views.css'
import { usePageTitle } from './pageTitle'

const busy = () => session.status === 'unknown' || isLoading()

// /views: every saved view of the account's teams, to open or delete. The same
// views are in the sidebar; this is where a view that is no longer wanted goes.
export function ViewsPage() {
    usePageTitle(() => 'Views')
    const [deleting, setDeleting] = createSignal<SavedView | null>(null)
    const views = () => sync.savedViews.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    const teamName = (id: string) => sync.teams.find((team) => team.id === id)?.name ?? ''
    onSettled(() => void ensureMembers())
    // A team's own view has no owner: any member may edit it.
    const ownerName = (view: SavedView) =>
        view.owner_account_id === null
            ? 'Team'
            : view.owner_account_id === viewer().accountId
              ? 'You'
              : (memberName(view.owner_account_id) ?? '—')

    return (
        <Show when={session.status !== 'unknown'}>
            <section aria-busy={busy() ? 'true' : undefined}>
                <h1 class="t-screen-title">Views</h1>
                <Show
                    when={views().length > 0}
                    fallback={
                        <div class="views-empty">
                            <h2 class="t-section">No saved views yet</h2>
                            <p class="t-body">
                                A saved view keeps a ticket list or board exactly as you set it up (filters, grouping,
                                sorting and columns) under a name, so you can come back to it in one click. Keep it
                                private, or share it with the team.
                            </p>
                            <p class="t-body">
                                To make one, open the ticket list or a board, set it up, then choose “Save view”.
                            </p>
                            <a class="button button--secondary views-empty__link" href="/">
                                Go to tickets
                            </a>
                        </div>
                    }
                >
                    <table class="views-table">
                        <thead>
                            <tr>
                                <th scope="col" class="t-overline">
                                    Name
                                </th>
                                <th scope="col" class="t-overline">
                                    Visibility
                                </th>
                                <th scope="col" class="t-overline">
                                    Owner
                                </th>
                                <th scope="col" class="t-overline">
                                    Updated
                                </th>
                                <th scope="col" class="t-overline views-table__actions">
                                    <span class="visually-hidden">Actions</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={views()} keyed={(view) => view.id}>
                                {(view) => (
                                    <tr>
                                        <td class="views-table__name" data-label="Name">
                                            <a class="t-body" href={`/views/${view().id}`}>
                                                {view().name}
                                            </a>
                                            <span class="t-meta">
                                                {view().layout === 'board' ? 'Board' : 'List'}
                                                {teamName(view().team_id) ? ` · ${teamName(view().team_id)}` : ''}
                                            </span>
                                        </td>
                                        <td class="t-body" data-label="Visibility">
                                            {view().is_shared ? 'Team' : 'Private'}
                                        </td>
                                        <td class="t-body" data-label="Owner">
                                            {ownerName(view())}
                                        </td>
                                        <td class="t-body" data-label="Updated">
                                            <Show when={view().updated_at} fallback="—">
                                                {(at) => <RelativeTime at={at()} />}
                                            </Show>
                                        </td>
                                        <td class="views-table__actions">
                                            <Show when={can('ticket:write') && canEditSavedView(view(), viewer().accountId)}>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={`Delete ${view().name}`}
                                                    onClick={() => setDeleting(view())}
                                                >
                                                    Delete
                                                </Button>
                                            </Show>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </Show>
                <Show when={deleting()} keyed>
                    {(view) => (
                        <Modal
                            title={`Delete “${view.name}”?`}
                            consequence={
                                view.is_shared
                                    ? 'It disappears from everyone’s sidebar. No tickets are touched.'
                                    : 'No tickets are touched.'
                            }
                            confirm="Delete view"
                            destructive
                            onConfirm={() => {
                                setDeleting(null)
                                void deleteSavedView(view.id)
                            }}
                            onCancel={() => setDeleting(null)}
                        />
                    )}
                </Show>
            </section>
        </Show>
    )
}

/** The project the list should show for this view, or null to leave it. A view
 *  of the whole team shows whichever project of that team is picked. */
function projectFor(view: SavedView): string | null {
    if (view.project_id) return view.project_id
    if (view.layout === 'board' && view.board_id) return boardById(view.board_id)?.project_id ?? null
    if (currentProject()?.team_id === view.team_id) return null
    return sync.projects.find((project) => project.team_id === view.team_id)?.id ?? null
}

// /views/:id: opening a saved view is going to the list or board with the setup
// it saved in the address (viewUrl). Nothing is shown of its own.
export function ViewPage() {
    usePageTitle(() => 'Views')
    const params = useParams<{ id: string }>()
    const navigate = useNavigate()
    const view = () => (busy() ? undefined : savedViewById(params.id))

    createEffect(
        () => {
            const found = view()
            return found ? JSON.stringify({ url: viewUrl(found), project: projectFor(found) }) : null
        },
        (target) => {
            if (!target) return
            const { url, project } = JSON.parse(target) as { url: string; project: string | null }
            void (async () => {
                if (project) await selectProject(project)
                navigate(url, { replace: true })
            })()
        },
    )

    return (
        <Show when={session.status !== 'unknown'}>
            <section aria-busy={busy() ? 'true' : undefined}>
                <Show
                    when={!busy() && !view()}
                    fallback={
                        <p class="visually-hidden" role="status">
                            Opening view…
                        </p>
                    }
                >
                    <h1 class="t-screen-title">View not found</h1>
                    <p class="t-body">
                        This account has no such saved view; it may have been deleted, or it is someone else’s private
                        view. <a href="/views">Back to views</a>
                    </p>
                </Show>
            </section>
        </Show>
    )
}
