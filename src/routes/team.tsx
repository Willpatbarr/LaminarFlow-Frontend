import { useParams } from '@solidjs/router'
import { For, Show } from 'solid-js'

import { session } from '@/features/auth'
import { isLoading, sync } from '@/sync'

// /teams/:teamId. Read from the local store only: the team's name and its
// projects, each a link to its tickets.
export function TeamPage() {
    const params = useParams<{ teamId: string }>()
    const team = () => sync.teams.find((candidate) => candidate.id === params.teamId)
    const projects = () => sync.projects.filter((project) => project.team_id === params.teamId)
    const busy = () => session.status === 'unknown' || isLoading()
    return (
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
                            <h2 class="t-body">Projects</h2>
                            <ul>
                                <For
                                    each={projects()}
                                    fallback={<li class="t-body">This team has no projects yet.</li>}
                                >
                                    {(project) => (
                                        <li>
                                            <a href={`/projects/${project.id}`}>{project.name}</a>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </>
                    )}
                </Show>
            </Show>
        </section>
    )
}
