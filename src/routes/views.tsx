import { useParams } from '@solidjs/router'
import { Show } from 'solid-js'

import { session } from '@/features/auth'

// Placeholders: saved views are LAM-86 and have no API yet. The routes exist so
// every section has a URL; the page says plainly that it is not built.
export function ViewsPage() {
    return (
        <Show when={session.status !== 'unknown'}>
            <section>
                <h1 class="t-screen-title">Views</h1>
                <p class="t-body">
                    Placeholder: saved views are not available yet. They arrive with the saved views
                    API (LAM-86).
                </p>
            </section>
        </Show>
    )
}

export function ViewPage() {
    const params = useParams<{ id: string }>()
    return (
        <Show when={session.status !== 'unknown'}>
            <section>
                <h1 class="t-screen-title">View</h1>
                <p class="t-body">
                    Placeholder: view {params.id} cannot be shown yet, because saved views are not
                    available. <a href="/views">Back to views</a>
                </p>
            </section>
        </Show>
    )
}
