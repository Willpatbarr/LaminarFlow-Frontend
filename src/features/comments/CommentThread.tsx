import { createMemo, createSignal, For, onSettled, Show } from 'solid-js'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { loadMembers, memberName } from '@/features/members/members'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import {
    commentHead,
    commentsFor,
    createComment,
    deleteComment,
    discard,
    isTempId,
    resolveId,
    updateComment,
    type Comment,
    type EntryError,
} from '@/sync'

import { commentCount, isBlank } from './limits'
import './comments.css'

/*
┌─ comments ──────────────────────────────────────
│  the comment thread of a ticket or a document (LAM-112)
├─ out ───────────────────────────────────────────
│      CommentThread   <CommentThread parent={{ ticketId }} accountId disabled />
*/
// Oldest first, with a composer under the last one. Everything goes through the
// sync engine, so a comment appears the moment it is posted, works offline, and
// other people's arrive from the change feed. Only the author is offered Edit
// and Delete; the server enforces it too (403 `comment_not_author`), and that
// answer is shown on the comment if it ever arrives.
//
// A comment says "You" for the viewer's own and the author's display name for
// anyone else's, from the workspace member list (LAM-121). Until that list has
// loaded, or if it cannot (offline), it says "Someone else". `author_id` null is
// a deleted account.
//
// A comment cannot name a ticket or document the server has not heard of yet, so
// the composer waits (and says so) while the parent still has a temporary id.

type Parent = { ticketId: string; documentId?: never } | { documentId: string; ticketId?: never }

type CommentThreadProps = {
    parent: Parent
    /** The signed-in account, for "yours". */
    accountId: string
    /** The page is read-only for now (a conflict to decide). */
    disabled?: boolean
}

function parentId(parent: Parent): string {
    return parent.ticketId ?? parent.documentId
}

function refusal(error: EntryError): string {
    if (error.code === 'comment_not_author') return 'Only the author can change this comment.'
    if (error.code === 'comment_not_found') return 'This comment no longer exists.'
    const detail = error.errors.map((e) => e.message).filter(Boolean)
    return detail.length > 0
        ? `The server didn't accept this comment: ${detail.join('; ')}.`
        : "The server didn't accept this comment."
}

export function CommentThread(props: CommentThreadProps) {
    const comments = createMemo(() => commentsFor(parentId(props.parent)))
    const unsent = () => isTempId(resolveId(parentId(props.parent)))
    const noun = () => (props.parent.ticketId !== undefined ? 'ticket' : 'document')

    onSettled(() => {
        void loadMembers()
    })

    const [draft, setDraft] = createSignal('')
    const count = () => commentCount(draft())
    const tooLong = () => count().used > count().max
    const [announcement, setAnnouncement] = createSignal('')

    async function post() {
        const text = draft().trim()
        if (isBlank(text) || tooLong() || unsent() || props.disabled) return
        const id = resolveId(parentId(props.parent))
        setDraft('')
        await createComment({
            ticket_id: props.parent.ticketId !== undefined ? id : null,
            document_id: props.parent.documentId !== undefined ? id : null,
            body: text,
        })
        setAnnouncement('Comment posted.')
    }

    return (
        <section class="comments" aria-labelledby="comments-title">
            <h2 id="comments-title" class="t-section">
                Comments
                <Show when={comments().length > 0}>
                    <span class="comments__meta"> ({comments().length})</span>
                </Show>
            </h2>

            <Show when={comments().length > 0} fallback={<p class="comments__none t-body">No comments yet.</p>}>
                <ol class="comments__list">
                    <For each={comments()} keyed={(comment) => comment.id}>
                        {(comment) => (
                            <CommentItem comment={comment()} mine={comment().author_id === props.accountId && props.accountId !== ''} disabled={props.disabled} />
                        )}
                    </For>
                </ol>
            </Show>

            <Show
                when={!unsent()}
                fallback={<p class="comments__meta t-meta">Comments open once this {noun()} has synced.</p>}
            >
                <form
                    class="comments__form"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void post()
                    }}
                >
                    <MarkdownEditor
                        label="Add a comment"
                        placeholder="Write a comment. Markdown and links work."
                        value={draft()}
                        readOnly={props.disabled}
                        onChange={setDraft}
                        count={count()}
                        error={tooLong() ? `A comment can be at most ${count().max} characters.` : undefined}
                    />
                    <Button type="submit" disabled={props.disabled || isBlank(draft()) || tooLong()}>
                        Comment
                    </Button>
                </form>
            </Show>
            <div class="visually-hidden" aria-live="polite" aria-atomic="true">
                {announcement()}
            </div>
        </section>
    )
}

type CommentItemProps = {
    comment: Comment
    mine: boolean
    disabled?: boolean
}

function CommentItem(props: CommentItemProps) {
    const [editing, setEditing] = createSignal(false)
    const [text, setText] = createSignal('')
    const [confirming, setConfirming] = createSignal(false)

    const head = createMemo(() => commentHead(props.comment.id))
    const refused = () => {
        const found = head()
        return found?.state === 'failed' && found.error ? { id: found.id, message: refusal(found.error) } : null
    }
    const waiting = () => {
        const found = head()
        if (!found || found.state === 'failed') return null
        if (found.state === 'unauthorized') return 'Not synced: sign in again'
        if (found.kind === 'archive') return 'Deleting…'
        return found.attempts > 0 ? 'Saved on this device. Not synced yet' : 'Sending…'
    }
    const author = () => (props.mine ? 'You' : props.comment.author_id === null ? 'Deleted account' : (memberName(props.comment.author_id) ?? 'Someone else'))
    const edited = () => props.comment.updated_at !== props.comment.created_at

    function startEdit() {
        setText(props.comment.body)
        setEditing(true)
    }

    async function save() {
        const body = text().trim()
        if (isBlank(body) || commentCount(body).used > commentCount(body).max) return
        setEditing(false)
        if (body !== props.comment.body) await updateComment(props.comment.id, { body })
    }

    return (
        <li class="comments__item" data-comment-id={props.comment.id}>
            <div class="comments__head t-meta">
                <span class="comments__author">{author()}</span>
                <RelativeTime at={props.comment.created_at} />
                <Show when={edited()}>
                    <span class="comments__meta">(edited)</span>
                </Show>
                <Show when={waiting()}>{(note) => <span class="comments__meta">{note()}</span>}</Show>
                <Show when={props.mine && !editing()}>
                    <span class="comments__actions">
                        <Button variant="ghost" size="sm" disabled={props.disabled} aria-label="Edit comment" onClick={startEdit}>
                            Edit
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={props.disabled}
                            aria-label="Delete comment"
                            onClick={() => setConfirming(true)}
                        >
                            Delete
                        </Button>
                    </span>
                </Show>
            </div>

            <Show when={refused()}>
                {(failure) => (
                    <div class="comments__failure" role="alert">
                        <p class="t-body">{failure().message}</p>
                        <Button variant="secondary" size="sm" onClick={() => void discard(failure().id)}>
                            Discard my change
                        </Button>
                    </div>
                )}
            </Show>

            <Show
                when={editing()}
                fallback={
                    <div class="comments__body">
                        <MarkdownEditor label="Comment" labelHidden readOnly value={props.comment.body} onChange={() => {}} />
                    </div>
                }
            >
                <form
                    class="comments__form"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void save()
                    }}
                >
                    <MarkdownEditor
                        label="Edit comment"
                        labelHidden
                        // Editing starts with the cursor after the last word.
                        ref={(editor) => editor.commands.focus('end')}
                        value={text()}
                        onChange={setText}
                        count={commentCount(text())}
                    />
                    <span class="comments__actions">
                        <Button type="submit" size="sm" disabled={isBlank(text()) || commentCount(text()).used > commentCount(text()).max}>
                            Save
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                            Cancel
                        </Button>
                    </span>
                </form>
            </Show>

            <Show when={confirming()}>
                <Modal
                    title="Delete this comment?"
                    consequence="It is removed for everyone."
                    confirm="Delete"
                    destructive
                    onConfirm={() => {
                        setConfirming(false)
                        void deleteComment(props.comment.id)
                    }}
                    onCancel={() => setConfirming(false)}
                />
            </Show>
        </li>
    )
}
