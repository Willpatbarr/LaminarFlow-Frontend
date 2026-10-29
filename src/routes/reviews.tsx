import '@/features/review/review.css'
import { createEffect, For, Show } from 'solid-js'

import { session } from '@/features/auth'
import { loadMembers, memberName } from '@/features/members/members'
import { loadNeedsMine, needsMine } from '@/features/review/feed'
import { documentById } from '@/sync'

// /reviews: the review requests that name the signed-in account, newest first.
// Only open ones: a request leaves this list when anyone listed answers it.
export function ReviewsPage() {
    createEffect(
        () => session.me?.account_id ?? '',
        (me) => {
            if (me) {
                void loadNeedsMine(me)
                void loadMembers()
            }
        },
    )
    return (
        <section class="reviews-page">
            <h1 class="t-screen-title">Needs my review</h1>
            <Show when={needsMine().length > 0} fallback={<p class="t-body">Nothing is waiting for your review.</p>}>
                <ul class="reviews-page__list">
                    <For each={needsMine()} keyed={(request) => request.id}>
                        {(request) => (
                            <li class="reviews-page__item">
                                <a class="t-body" href={`/documents/${request().document_id}`}>
                                    {documentById(request().document_id)?.title || 'Untitled'}
                                </a>
                                <span class="t-meta">
                                    {' '}
                                    asked by {request().author_id === null ? 'someone whose account was deleted' : (memberName(request().author_id) ?? 'someone')}
                                </span>
                                <Show when={request().anchor_text}>{(quote) => <blockquote class="review-quote t-body">{quote()}</blockquote>}</Show>
                                <p class="t-body">{request().body}</p>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
        </section>
    )
}
