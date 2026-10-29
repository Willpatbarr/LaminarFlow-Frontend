import { useParams } from '@solidjs/router'
import { Show } from 'solid-js'

import { session } from '@/features/auth'
import { Board } from '@/features/tickets/components/Board'
import { boardById, isLoading } from '@/sync'

import { viewer } from './viewer'

// /boards/:id. The id follows the URL, like the ticket page's.
export function BoardPage() {
    const params = useParams<{ id: string }>()
    const busy = () => session.status === 'unknown' || isLoading()
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
                        <>
                            <h1 class="t-screen-title">Board not found</h1>
                            <p class="t-body">
                                This account has no such board. <a href="/">Back to tickets</a>
                            </p>
                        </>
                    }
                >
                    {(found) => <Board board={found()} viewer={viewer()} />}
                </Show>
            </Show>
        </section>
    )
}
