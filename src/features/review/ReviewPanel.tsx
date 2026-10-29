import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { loadMembers, memberName } from '@/features/members/members'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { createComment, resolveId, type Comment } from '@/sync'

import { textAt } from './anchor'
import { decideReviewRequest, type ReviewStatus } from './api'
import { detailOf, loadDetails, openRequestsFor } from './feed'
import './review.css'

/*
┌─ review ────────────────────────────────────────
│  the document's open review requests, and what a reviewer can do with each
├─ out ───────────────────────────────────────────
│      OpenRequestsCount   <OpenRequestsCount documentId />   "2 open review requests", jumps between them
│      ReviewPanel         <ReviewPanel documentId accountId fieldText disabled onAnnounce />
*/
// Everything is worded as a request and an answer, never a verdict: "Approve",
// "Request changes" and "Comment" are the three things a reviewer can do, and
// a refusal says what the server said without blame. Approve and Request
// changes are a PUT; Comment is an ordinary comment on the document, because
// replies are not threaded.

const cardId = (id: string) => `review-${id}`

function who(id: string | null): string {
    return id === null ? 'Someone whose account was deleted' : (memberName(id) ?? 'Someone')
}

export function OpenRequestsCount(props: { documentId: string }) {
    const open = createMemo(() => openRequestsFor(props.documentId))
    const [at, setAt] = createSignal(-1)

    function jump() {
        const list = open()
        if (list.length === 0) return
        const next = (at() + 1) % list.length
        setAt(next)
        const card = document.getElementById(cardId(list[next].id))
        card?.scrollIntoView({ block: 'center' })
        card?.focus()
    }

    return (
        <Show when={open().length > 0}>
            <button type="button" class="review-count t-meta" onClick={jump}>
                {open().length === 1 ? '1 open review request' : `${open().length} open review requests`}
                <span class="review-count__hint">{open().length === 1 ? ' · go to it' : ' · go to the next'}</span>
            </button>
        </Show>
    )
}

type PanelProps = {
    documentId: string
    accountId: string
    /** The stored Markdown of a field (null: the document's text), to tell whether the quoted words moved. */
    fieldText: (fieldId: string | null) => string
    disabled?: boolean
    onAnnounce: (text: string) => void
}

export function ReviewPanel(props: PanelProps) {
    const open = createMemo(() => openRequestsFor(props.documentId))

    // Reviewers and quotes are asked for when a request shows that has none yet.
    createEffect(
        () => open().filter((request) => !detailOf(request.id)).length,
        (missing) => {
            if (missing > 0) void loadDetails({ documentId: resolveId(props.documentId) })
        },
    )
    // A request that went back to open carries why (`stale_reason`), which the
    // comment row does not: ask again when one of them changes after the first look.
    createEffect(
        () => `${resolveId(props.documentId)}|${open().map((request) => `${request.id}@${request.updated_at}`).join(',')}`,
        (stamp, previous) => {
            const [documentId, requests] = [stamp.slice(0, stamp.indexOf('|')), stamp.slice(stamp.indexOf('|') + 1)]
            if (previous !== undefined && requests !== '') void loadDetails({ documentId })
        },
    )
    createEffect(
        () => open().length,
        (n) => {
            if (n > 0) void loadMembers()
        },
    )

    return (
        <Show when={open().length > 0}>
            <section class="review" aria-labelledby="review-title">
                <h2 id="review-title" class="t-section">
                    Review requests <span class="comments__meta">({open().length})</span>
                </h2>
                <ol class="review__list">
                    <For each={open()} keyed={(request) => request.id}>
                        {(request) => <RequestCard request={request()} {...props} />}
                    </For>
                </ol>
            </section>
        </Show>
    )
}

function RequestCard(props: PanelProps & { request: Comment }) {
    const detail = () => detailOf(props.request.id)
    const asked = () => detail()?.reviewers?.map((r) => r.account_id) ?? []
    const isReviewer = () => asked().includes(props.accountId)
    const quote = () => detail()?.anchor_text ?? null
    // The words at the range now, against the words quoted when it was made.
    const moved = () => {
        const q = quote()
        const start = props.request.region_start
        const end = props.request.region_end
        if (q === null || start === null || end === null) return false
        return textAt(props.fieldText(props.request.field_id), start, end) !== q
    }

    const staleNote = () => {
        const reason = detail()?.stale_reason
        if (!reason) return null
        // Said as what happened to the text, not as a verdict on anyone's work.
        return reason === 'anchored text changed'
            ? 'This is open again because the text it points at was edited.'
            : `This is open again: ${reason}.`
    }

    const [busy, setBusy] = createSignal(false)
    const [problem, setProblem] = createSignal('')
    const [commenting, setCommenting] = createSignal(false)
    const [reply, setReply] = createSignal('')

    async function decide(status: ReviewStatus, done: string) {
        if (busy()) return
        setBusy(true)
        setProblem('')
        const result = await decideReviewRequest(props.request.id, status)
        setBusy(false)
        if (result.ok) props.onAnnounce(done)
        else setProblem(result.message)
    }

    async function postComment() {
        const text = reply().trim()
        if (text === '') return
        setReply('')
        setCommenting(false)
        await createComment({ ticket_id: null, document_id: resolveId(props.documentId), body: text })
        props.onAnnounce('Comment posted.')
    }

    return (
        <li class="review__card" id={cardId(props.request.id)} tabindex="-1" data-request-id={props.request.id}>
            <div class="review__head t-meta">
                <span class="review__author">Review requested by {props.request.author_id === props.accountId ? 'you' : who(props.request.author_id)}</span>
                <RelativeTime at={props.request.created_at} />
            </div>
            <Show when={quote()}>
                {(text) => <blockquote class="review-quote t-body">{text()}</blockquote>}
            </Show>
            <Show when={staleNote()}>{(text) => <p class="t-meta review__stale">{text()}</p>}</Show>
            <Show when={moved()}>
                <p class="t-meta">The text has changed since this was requested.</p>
            </Show>
            <MarkdownEditor label="Note" labelHidden readOnly value={props.request.body} onChange={() => {}} />
            <Show when={asked().length > 0}>
                <p class="t-meta">Asked: {asked().map((id) => (id === props.accountId ? 'you' : who(id))).join(', ')}</p>
            </Show>

            <Show when={isReviewer()}>
                <div class="review__actions">
                    <Button size="sm" disabled={busy() || props.disabled} onClick={() => void decide('approved', 'Approved.')}>
                        Approve
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy() || props.disabled}
                        onClick={() => void decide('changes_requested', 'Changes requested.')}
                    >
                        Request changes
                    </Button>
                    <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => setCommenting(!commenting())}>
                        Comment
                    </Button>
                </div>
            </Show>
            <Show when={commenting()}>
                <form
                    class="review__reply"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void postComment()
                    }}
                >
                    <TextArea label="Your comment" rows={3} value={reply()} onInput={setReply} />
                    <div>
                        <Button type="submit" size="sm" disabled={reply().trim() === ''}>
                            Post comment
                        </Button>
                    </div>
                </form>
            </Show>
            <Show when={problem()}>
                <p class="review__problem t-body" role="alert">
                    {problem()}
                </p>
            </Show>
        </li>
    )
}
