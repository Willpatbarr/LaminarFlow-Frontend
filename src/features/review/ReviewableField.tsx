import type { Editor } from '@tiptap/core'
import { createSignal, For, Show } from 'solid-js'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import type { ImageUpload } from '@/components/editor/images'
import { Button } from '@/components/ui/Button'
import { memberName } from '@/features/members/members'
import type { Comment } from '@/sync'

import { detailOf } from './feed'
import { outcomeText } from './ReviewPanel'

import { anchorOfSelection } from './anchor'
import { RequestReviewDialog } from './RequestReviewDialog'
import './review.css'

/*
┌─ review ────────────────────────────────────────
│  a document field you can ask for a review of: select text, then "Request review"
├─ out ───────────────────────────────────────────
│      ReviewableField   <MarkdownEditor …> plus documentId, fieldId, stored, canRequest, open
*/
// Wraps the editor and adds three things: the button (live while text is
// selected), the dialog it opens, and the margin mark on a field that has open
// requests. The range sent is worked out from the stored Markdown, never from
// the editor's own positions (see anchor.ts).

/** What a field needs to know about the document it is part of. */
export type ReviewContext = {
    documentId: string
    accountId: string
    /** False while there are changes the server has not got: the range would be measured against old text. */
    canRequest: boolean
    /** The open requests on this field. */
    open: Comment[]
    /** The approved and changes-requested ones: the mark stays, saying what was decided (LAM-132). */
    decided: Comment[]
    onAsked: (announcement: string) => void
}

type Props = ReviewContext & {
    label: string
    placeholder?: string
    value: string
    readOnly?: boolean
    onChange: (markdown: string) => void
    onBlur?: () => void
    /** Pasted and dropped images (LAM-116). */
    images?: ImageUpload
    /** The aspect field this editor holds; null for a normal document's text. */
    fieldId: string | null
    /** The field's Markdown as the server holds it. */
    stored: () => string
}

export function ReviewableField(props: Props) {
    const [selecting, setSelecting] = createSignal(false)
    const [problem, setProblem] = createSignal('')
    const [asking, setAsking] = createSignal<{ start: number; end: number; text: string } | null>(null)
    let editor: Editor | undefined

    function capture(found: Editor) {
        editor = found
        const update = () => setSelecting(!found.state.selection.empty)
        found.on('selectionUpdate', update)
    }

    function begin() {
        if (!editor) return
        const anchor = anchorOfSelection(editor, props.stored())
        if (!anchor.ok) {
            setProblem(anchor.reason)
            return
        }
        setProblem('')
        setAsking(anchor)
    }

    const count = () => props.open.length
    // "Riley approved"; one line per decided request, so nothing a reviewer said is lost to a count.
    const outcomes = () =>
        props.decided.map((request) => {
            const status = request.review_status as 'approved' | 'changes_requested'
            const held = detailOf(request.id)
            const who = held && held.review_status === status ? (held.decided_by ? memberName(held.decided_by) ?? 'Someone' : 'A reviewer') : null
            const me = held?.decided_by === props.accountId
            return { id: request.id, status, text: who === null ? (status === 'approved' ? 'Approved' : 'Changes requested') : outcomeText(status, me ? 'You' : who) }
        })

    return (
        <div
            class="reviewable"
            data-open={count() > 0 ? 'true' : undefined}
            data-decided={count() === 0 && props.decided.length > 0 ? 'true' : undefined}
        >
            <Show when={count() > 0}>
                <span class="reviewable__margin t-meta" role="note">
                    {count() === 1 ? '1 open review request' : `${count()} open review requests`}
                </span>
            </Show>
            <For each={outcomes()} keyed={(outcome) => outcome.id}>
                {(outcome) => (
                    <span class="reviewable__margin reviewable__margin--decided t-meta" role="note" data-outcome={outcome().status}>
                        {outcome().text}
                    </span>
                )}
            </For>
            <MarkdownEditor
                label={props.label}
                placeholder={props.placeholder}
                value={props.value}
                readOnly={props.readOnly}
                onChange={props.onChange}
                onBlur={props.onBlur}
                images={props.images}
                ref={capture}
            />
            <div class="reviewable__actions">
                <Button variant="secondary" size="sm" disabled={!selecting() || !props.canRequest} onClick={begin}>
                    Request review
                </Button>
                <Show when={selecting() && !props.canRequest}>
                    <span class="t-meta">Available once your latest changes are saved.</span>
                </Show>
                <Show when={problem()}>
                    <span class="t-meta" role="status">
                        {problem()}
                    </span>
                </Show>
            </div>
            <Show when={asking()}>
                {(range) => (
                    <RequestReviewDialog
                        documentId={props.documentId}
                        fieldId={props.fieldId}
                        quote={range().text}
                        start={range().start}
                        end={range().end}
                        accountId={props.accountId}
                        onDone={() => {
                            setAsking(null)
                            props.onAsked('Review requested.')
                        }}
                        onClose={() => setAsking(null)}
                    />
                )}
            </Show>
        </div>
    )
}
