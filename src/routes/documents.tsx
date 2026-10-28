import { useParams } from '@solidjs/router'
import { Show } from 'solid-js'

import { session } from '@/features/auth'

// Placeholders: documents have no API yet (no openapi path), so there is
// nothing to list or open. The routes exist so every section has a URL and a
// link can point at it; the page says plainly that it is not built.
export function DocumentsPage() {
    return (
        <Show when={session.status !== 'unknown'}>
            <section>
                <h1 class="t-screen-title">Documents</h1>
                <p class="t-body">
                    Placeholder: documents are not available yet. This page will list them once the
                    documents API exists.
                </p>
            </section>
        </Show>
    )
}

export function DocumentPage() {
    const params = useParams<{ id: string }>()
    return (
        <Show when={session.status !== 'unknown'}>
            <section>
                <h1 class="t-screen-title">Document</h1>
                <p class="t-body">
                    Placeholder: document {params.id} cannot be shown yet, because documents are not
                    available. <a href="/documents">Back to documents</a>
                </p>
            </section>
        </Show>
    )
}
