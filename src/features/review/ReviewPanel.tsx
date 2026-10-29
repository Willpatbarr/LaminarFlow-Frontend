import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { loadMembers, memberName } from '@/features/members/members'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { createComment, resolveId, type Comment } from '@/sync'

import { textAt } from './anchor'
import { decideReviewRequest, type ReviewStatus } from './api'
import { detailOf, loadDetails, openRequestsFor, remember, requestsFor } from './feed'
import './review.css'

/*
┌─ review ────────────────────────────────────────
│  the document's open review requests, and what a reviewer can do with each
├─ out ───────────────────────────────────────────
│      OpenRequestsCount   <OpenRequestsCount documentId />   "2 open review requests", jumps between them
│      ReviewPanel         <ReviewPanel documentId accountId fieldText disabled onAnnounce />
│      outcomeText(status, name)   "Riley approved" · "Riley requested changes"
*/
// Everything is worded as a request and an answer, never a verdict: "Approve",
// "Request changes" and "Comment" are the three things a reviewer can do, and
// a refusal says what the server said without blame. Approve and Request
// changes are a PUT; Comment is an ordinary comment on the document, because
// replies are not threaded.
//
// A decided request stays on the page (LAM-132): its card keeps its place in the
// list and folds to a one-line summary that says what was decided and by whom,
// with the note under it. Folding is the reader's choice (a native <details>);
// nothing is removed. Request changes asks for a short note first, which can be
// left empty.

const cardId = (id: string) => `review-${id}`

/** "Riley approved", "You requested changes": what happened, with no verdict on anyone. */
export function outcomeText(status: 'approved' | 'changes_requested', name: string): string {
    return `${name} ${status === 'approved' ? 'approved' : 'requested changes'}`
}

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
    const all = createMemo(() => requestsFor(props.documentId))

    // Reviewers and quotes are asked for when a request shows that has none yet.
    createEffect(
        () => ({ missing: all().filter((request) => !detailOf(request.id)).length, documentId: resolveId(props.documentId) }),
        ({ missing, documentId }) => {
            if (missing > 0) void loadDetails({ documentId })
        },
    )
    // A request that went back to open carries why (`stale_reason`), and a decided one
    // carries who decided and the note; the comment row has neither: ask again when
    // one of them changes after the first look.
    createEffect(
        () => `${resolveId(props.documentId)}|${all().map((request) => `${request.id}@${request.updated_at}`).join(',')}`,
        (stamp, previous) => {
            const [documentId, requests] = [stamp.slice(0, stamp.indexOf('|')), stamp.slice(stamp.indexOf('|') + 1)]
            if (previous !== undefined && requests !== '') void loadDetails({ documentId })
        },
    )
    createEffect(
        () => all().length,
        (n) => {
            if (n > 0) void loadMembers()
        },
    )

    return (
        <Show when={all().length > 0}>
            <section class="review" aria-labelledby="review-title">
                <h2 id="review-title" class="t-section">
                    Review requests{' '}
                    <span class="comments__meta">
                        ({all().length === open().length ? open().length : `${open().length} open · ${all().length - open().length} decided`})
                    </span>
                </h2>
                <ol class="review__list">
                    <For each={all()} keyed={(request) => request.id}>
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
        if (!reason || status() !== 'pending') return null
        // Said as what happened to the text, not as a verdict on anyone's work.
        return reason === 'anchored text changed'
            ? 'This is open again because the text it points at was edited.'
            : `This is open again: ${reason}.`
    }

    // Our own answer to a decision is held at once; the row follows when the change
    // feed delivers it. Whichever is newer says what the status is, so the card
    // changes in place the moment the server has said yes.
    const status = () => {
        const held = detail()
        return held && held.updated_at > props.request.updated_at ? held.review_status : props.request.review_status
    }
    const decided = () => (status() === 'approved' || status() === 'changes_requested' ? (status() as 'approved' | 'changes_requested') : null)
    // Who decided and the note come from the request itself, and only once it is the
    // one that matches the status: the copy held from before the decision says neither.
    const decision = () => {
        const held = detail()
        return held && held.review_status === status() ? held : null
    }
    const decidedBy = () => {
        const held = decision()
        if (!held) return null
        if (held.decided_by === props.accountId) return 'You'
        return held.decided_by ? who(held.decided_by) : 'A reviewer'
    }
    const summary = () => {
        const status = decided()
        if (!status) return ''
        const name = decidedBy()
        // Until the details arrive the outcome alone is true; the name follows.
        return name ? outcomeText(status, name) : status === 'approved' ? 'Approved' : 'Changes requested'
    }

    const [busy, setBusy] = createSignal(false)
    const [problem, setProblem] = createSignal('')
    const [commenting, setCommenting] = createSignal(false)
    const [reply, setReply] = createSignal('')
    const [noting, setNoting] = createSignal(false)
    const [note, setNote] = createSignal('')

    async function decide(status: ReviewStatus, done: string, text = '') {
        if (busy()) return
        setBusy(true)
        setProblem('')
        const result = await decideReviewRequest(props.request.id, status, text)
        setBusy(false)
        if (result.ok) {
            remember([result.data])
            setNoting(false)
            setNote('')
            props.onAnnounce(done)
        } else setProblem(result.message)
    }

    async function postComment() {
        const text = reply().trim()
        if (text === '') return
        setReply('')
        setCommenting(false)
        await createComment({ ticket_id: null, document_id: resolveId(props.documentId), body: text })
        props.onAnnounce('Comment posted.')
    }

    const head = () => (
        <>
            <span class="review__author">Review requested by {props.request.author_id === props.accountId ? 'you' : who(props.request.author_id)}</span>
            <RelativeTime at={props.request.created_at} />
        </>
    )

    const body = () => (
        <>
            <Show when={decided()}>
                <Show when={decision()?.decision_note}>
                    {(text) => (
                        <p class="review__decision-note t-body" data-testid="decision-note">
                            {text()}
                        </p>
                    )}
                </Show>
            </Show>
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
        </>
    )

    const actions = () => (
        <Show when={isReviewer()}>
            <div class="review__actions">
                <Show when={decided() !== 'approved'}>
                    <Button size="sm" disabled={busy() || props.disabled} onClick={() => void decide('approved', 'Approved.')}>
                        Approve
                    </Button>
                </Show>
                <Show when={decided() !== 'changes_requested'}>
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy() || props.disabled}
                        onClick={() => setNoting(!noting())}
                    >
                        Request changes
                    </Button>
                </Show>
                <Show when={decided()}>
                    <Button size="sm" variant="ghost" disabled={busy() || props.disabled} onClick={() => void decide('pending', 'Reopened.')}>
                        Reopen
                    </Button>
                </Show>
                <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => setCommenting(!commenting())}>
                    Comment
                </Button>
            </div>
        </Show>
    )

    return (
        <li
            class="review__card"
            id={cardId(props.request.id)}
            tabindex="-1"
            data-request-id={props.request.id}
            data-status={status() ?? undefined}
        >
            <Show
                when={decided()}
                fallback={
                    <>
                        <div class="review__head t-meta">{head()}</div>
                        {body()}
                    </>
                }
            >
                <details class="review__decided" open>
                    <summary class="review__summary">
                        <span class="review__outcome">
                            {summary()}
                        </span>
                        <RelativeTime at={decision()?.decided_at ?? props.request.updated_at} />
                    </summary>
                    <div class="review__head t-meta">{head()}</div>
                    {body()}
                </details>
            </Show>
            {actions()}
            <Show when={noting()}>
                <form
                    class="review__reply"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void decide('changes_requested', 'Changes requested.', note())
                    }}
                >
                    <TextArea label="What would help? (optional)" rows={3} value={note()} onInput={setNote} />
                    <div class="review__actions">
                        <Button type="submit" size="sm" disabled={busy()}>
                            Request changes
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setNoting(false)}>
                            Cancel
                        </Button>
                    </div>
                </form>
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
