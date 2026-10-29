import { useNavigate, useParams } from '@solidjs/router'
import { createSignal, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'

import { session } from '@/features/auth'
import { CONTENT_KEY } from '@/features/documents/content'
import { DocumentDetail } from '@/features/documents/components/DocumentDetail'
import { createDocument, currentProject } from '@/sync'

// The list is LAM-97's. Until it lands this page says so, and offers the one
// thing that is needed to reach a document page: making a new one. The write is
// local, so it works offline; the page opens at once under a temporary id.
export function DocumentsPage() {
    const navigate = useNavigate()
    const [creating, setCreating] = createSignal(false)

    async function create() {
        setCreating(true)
        const document = await createDocument({
            title: '',
            type: 'normal',
            aspect_type_id: null,
            team_id: null,
            project_id: currentProject()?.id ?? null,
            body: { [CONTENT_KEY]: '' },
        })
        navigate(`/documents/${document.id}`)
    }

    return (
        <Show when={session.status !== 'unknown'}>
            <section>
                <h1 class="t-screen-title">Documents</h1>
                <p class="t-body">Browsing documents is not built yet.</p>
                <Button variant="primary" disabled={creating()} onClick={() => void create()}>
                    New document
                </Button>
            </section>
        </Show>
    )
}

// /documents/:id. The id goes down as a prop that follows the URL.
export function DocumentPage() {
    const params = useParams<{ id: string }>()
    return <DocumentDetail id={params.id} loading={session.status === 'unknown'} />
}
