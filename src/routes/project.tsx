import { useParams } from '@solidjs/router'
import { createEffect, Show, untrack } from 'solid-js'

import { session } from '@/features/auth'
import { TicketList } from '@/features/tickets/components/TicketList'
import { currentProject, isLoading, selectProject, sync } from '@/sync'

import { viewer } from './viewer'

// /projects/:projectId: that project's tickets. The ticket list shows the
// picked project, so the URL picks it. Until the pick lands the list stays in
// its loading state instead of flashing a different project.
export function ProjectPage() {
    const params = useParams<{ projectId: string }>()
    const exists = () => sync.projects.some((project) => project.id === params.projectId)

    createEffect(
        () => (exists() ? params.projectId : null),
        (id) => {
            // Only the id should re-run this, not the store it then writes to.
            if (id && untrack(() => currentProject()?.id) !== id) void selectProject(id)
        },
    )

    const picked = () => currentProject()?.id === params.projectId
    return (
        <Show
            when={exists() || session.status === 'unknown' || isLoading()}
            fallback={
                <section>
                    <h1 class="t-screen-title">Project not found</h1>
                    <p class="t-body">
                        This account has no such project. <a href="/">Back to tickets</a>
                    </p>
                </section>
            }
        >
            <TicketList
                viewer={viewer()}
                loading={session.status === 'unknown' || !exists() || !picked()}
            />
        </Show>
    )
}
