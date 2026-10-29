import { useParams } from '@solidjs/router'

import { session } from '@/features/auth'
import { DocumentList } from '@/features/documents/components/DocumentList'
import { DocumentDetail } from '@/features/documents/components/DocumentDetail'

// /documents: every document, filterable by project, type and aspect type.
// "New document" makes one locally (works offline) and opens it at once under
// a temporary id.
export function DocumentsPage() {
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
    return <DocumentDetail id={params.id} loading={session.status === 'unknown'} />
}
