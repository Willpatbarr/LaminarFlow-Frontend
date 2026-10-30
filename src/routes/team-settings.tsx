import { useParams } from '@solidjs/router'
import { Show } from 'solid-js'

import { session } from '@/features/auth'
import { TeamNameField } from '@/features/tickets/components/NameEditor'
import { LabelEditor } from '@/features/tickets/components/LabelEditor'
import { StatusEditor } from '@/features/tickets/components/StatusEditor'
import { isLoading, sync } from '@/sync'

import './team-settings.css'
import { usePageTitle } from './pageTitle'

// /teams/:teamId/settings. The team's statuses (LAM-95) and labels (LAM-104); the board's
// column menu opens the same editor (LAM-107).
export function TeamSettingsPage() {
    const params = useParams<{ teamId: string }>()
    const team = () => sync.teams.find((candidate) => candidate.id === params.teamId)
    usePageTitle(() => (team() ? `Team settings · ${team()!.name}` : undefined))
    const busy = () => session.status === 'unknown' || isLoading()
    return (
        <section aria-busy={busy() ? 'true' : undefined}>
            <Show
                when={!busy()}
                fallback={
                    <p class="visually-hidden" role="status">
                        Loading team settings…
                    </p>
                }
            >
                <Show
                    when={team()}
                    fallback={
                        <>
                            <h1 class="t-screen-title">Team not found</h1>
                            <p class="t-body">
                                This account has no such team. <a href="/">Back to tickets</a>
                            </p>
                        </>
                    }
                >
                    {(found) => (
                        <div class="settings">
                            <p class="t-body">
                                <a href={`/teams/${found().id}`}>← {found().name}</a>
                            </p>
                            <h1 class="t-screen-title settings__title">Team settings</h1>
                            <section class="settings__section">
                                <h2 class="t-section">Name</h2>
                                <TeamNameField teamId={found().id} name={found().name} />
                            </section>
                            <section class="settings__section">
                                <h2 class="t-section">Statuses</h2>
                                <p class="t-meta">
                                    Rename, reorder, add or delete. No status is special: even the first three can go.
                                </p>
                                <StatusEditor teamId={found().id} />
                            </section>
                            <section class="settings__section">
                                <h2 class="t-section">Labels</h2>
                                <p class="t-meta">
                                    How a ticket is marked as a bug, a feature or a task. Names are unique in the team.
                                </p>
                                <LabelEditor teamId={found().id} />
                            </section>
                            <section class="settings__section">
                                <h2 class="t-section">Aspect types</h2>
                                <p class="t-meta">The labeled fields a document can have.</p>
                                <p class="t-body">
                                    <a href={`/teams/${found().id}/aspect-types`}>Edit aspect types</a>
                                </p>
                            </section>
                        </div>
                    )}
                </Show>
            </Show>
        </section>
    )
}
