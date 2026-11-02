import { useParams } from '@solidjs/router'
import { For, Show } from 'solid-js'

import { ListBar, ListBars } from '@/components/ui/ListBar'
import { PageLayout } from '@/components/ui/PageLayout'
import { session } from '@/features/auth'
import { isLoading, sync } from '@/sync'
import { usePageTitle } from './pageTitle'

// /teams/:teamId. Read from the local store only: the team's name and its
// projects, each a link to its tickets.
export function TeamPage() {
    const params = useParams<{ teamId: string }>()
    const team = () => sync.teams.find((candidate) => candidate.id === params.teamId)
    const projects = () => sync.projects.filter((project) => project.team_id === params.teamId)
    usePageTitle(() => (team() ? team()!.name : undefined))
    const busy = () => session.status === 'unknown' || isLoading()
    return (
        <PageLayout>
        <section aria-busy={busy() ? 'true' : undefined}>
            <Show
                when={!busy()}
                fallback={
                    <p class="visually-hidden" role="status">
                        Loading team…
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
                        <>
                            <h1 class="t-screen-title">{found().name}</h1>
                            <p class="t-body">
                                <a href={`/teams/${found().id}/settings`}>Team settings</a>
                            </p>
                            <h2 class="t-body">Projects</h2>
                            <Show
                                when={projects().length > 0}
                                fallback={<p class="t-body">This team has no projects yet.</p>}
                            >
                                <ListBars label="Projects">
                                    <For each={projects()}>
                                        {(project) => <ListBar href={`/projects/${project.id}`} title={project.name} />}
                                    </For>
                                </ListBars>
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
        </section>
        </PageLayout>
    )
}
