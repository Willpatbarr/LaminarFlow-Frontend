import { useParams } from '@solidjs/router'

import { session } from '@/features/auth'
import { documentById } from '@/sync'
import { DocumentList } from '@/features/documents/components/DocumentList'
import { DocumentDetail } from '@/features/documents/components/DocumentDetail'

import { viewer } from './viewer'
import { usePageTitle } from './pageTitle'

// /documents: every document, filterable by project, type and aspect type.
// "New document" makes one locally (works offline) and opens it at once under
// a temporary id.
export function DocumentsPage() {
    usePageTitle(() => 'Documents')
    return (
        <section>
            <h1 class="t-screen-title">Documents</h1>
            <DocumentList loading={session.status === 'unknown'} />
        </section>
    )
}

// /documents/:id. The id goes down as a prop that follows the URL.
export function DocumentPage() {
    const params = useParams<{ id: string }>()
    usePageTitle(() => {
        const found = documentById(params.id)
        return found ? found.title.trim() || 'Untitled document' : undefined
    })
    return <DocumentDetail id={params.id} accountId={viewer().accountId} loading={session.status === 'unknown'} />
}
