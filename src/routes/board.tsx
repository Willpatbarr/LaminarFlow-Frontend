import { useParams } from '@solidjs/router'
import { Show } from 'solid-js'

import { PageLayout } from '@/components/ui/PageLayout'
import { session } from '@/features/auth'
import { ProjectFrame } from '@/features/tickets/components/ProjectFrame'
import { Board } from '@/features/tickets/components/Board'
import { boardById, isLoading, sync } from '@/sync'

import { viewer } from './viewer'
import { usePageTitle } from './pageTitle'

// /boards/:id. The id follows the URL, like the ticket page's.
export function BoardPage() {
    const params = useParams<{ id: string }>()
    const busy = () => session.status === 'unknown' || isLoading()
    usePageTitle(() => {
        const found = boardById(params.id)
        if (!found) return busy() ? undefined : 'Board not found'
        const project = sync.projects.find((candidate) => candidate.id === found.project_id)
        return project ? `${project.name} · ${found.name}` : found.name
    })
    return (
        <section aria-busy={busy() ? 'true' : undefined}>
            <Show
                when={!busy()}
                fallback={
                    <p class="visually-hidden" role="status">
                        Loading board…
                    </p>
                }
            >
                <Show
                    when={boardById(params.id)}
                    fallback={
                        <PageLayout title={<h1 class="t-screen-title">Board not found</h1>}>
                            <p class="t-body">
                                This account has no such board. <a href="/">Back to tickets</a>
                            </p>
                        </PageLayout>
                    }
                >
                    {(found) => (
                        // The board is a wide view: the whole width, still centred, under the
                        // same header as the project's list (LAM-201).
                        <ProjectFrame
                            projectId={found().project_id}
                            name={sync.projects.find((candidate) => candidate.id === found().project_id)?.name ?? found().name}
                            tab="tickets"
                            size="wide"
                        >
                            <Board board={found()} viewer={viewer()} />
                        </ProjectFrame>
                    )}
                </Show>
            </Show>
        </section>
    )
}
