import { useParams } from '@solidjs/router'
import { createEffect, Show, untrack } from 'solid-js'

import { PageLayout } from '@/components/ui/PageLayout'
import { session } from '@/features/auth'
import { DocumentList } from '@/features/documents/components/DocumentList'
import { ProjectFrame } from '@/features/tickets/components/ProjectFrame'
import { TicketList } from '@/features/tickets/components/TicketList'
import { currentProject, isLoading, selectProject, sync } from '@/sync'

import { viewer } from './viewer'
import { usePageTitle } from './pageTitle'

// /projects/:projectId: that project's tickets. The ticket list shows the
// picked project, so the URL picks it. Until the pick lands the list stays in
// its loading state instead of flashing a different project.
export function ProjectPage(props: { tab?: 'tickets' | 'documents' }) {
    const params = useParams<{ projectId: string }>()
    const exists = () => sync.projects.some((project) => project.id === params.projectId)

    createEffect(
        () => (exists() ? params.projectId : null),
        (id) => {
            // Only the id should re-run this, not the store it then writes to.
            if (id && untrack(() => currentProject()?.id) !== id) void selectProject(id)
        },
    )

    usePageTitle(() => {
        const found = sync.projects.find((project) => project.id === params.projectId)
        if (!found) return exists() || session.status === 'unknown' || isLoading() ? undefined : 'Project not found'
        return props.tab === 'documents' ? `${found.name} · Documents` : found.name
    })
    const picked = () => currentProject()?.id === params.projectId
    return (
        <Show
            when={exists() || session.status === 'unknown' || isLoading()}
            fallback={
                <PageLayout title={<h1 class="t-screen-title">Project not found</h1>}>
                    <p class="t-body">
                        This account has no such project. <a href="/">Back to tickets</a>
                    </p>
                </PageLayout>
            }
        >
            <ProjectFrame
                projectId={params.projectId}
                name={sync.projects.find((project) => project.id === params.projectId)?.name}
                tab={props.tab ?? 'tickets'}
            >
                <Show
                    when={props.tab === 'documents'}
                    fallback={
                        <TicketList
                            viewer={viewer()}
                            heading="h2"
                            loading={session.status === 'unknown' || !exists() || !picked()}
                        />
                    }
                >
                    <h2 class="t-screen-title">Documents</h2>
                    <DocumentList
                        projectId={params.projectId}
                        loading={session.status === 'unknown' || !exists()}
                    />
                </Show>
            </ProjectFrame>
        </Show>
    )
}

// /projects/:projectId/documents: the same page, on its Documents tab.
export function ProjectDocumentsPage() {
    return <ProjectPage tab="documents" />
}
