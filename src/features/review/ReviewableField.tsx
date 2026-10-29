import type { Editor } from '@tiptap/core'
import { createSignal, Show } from 'solid-js'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { Button } from '@/components/ui/Button'
import type { Comment } from '@/sync'

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
    onAsked: (announcement: string) => void
}

type Props = ReviewContext & {
    label: string
    placeholder?: string
    value: string
    readOnly?: boolean
    onChange: (markdown: string) => void
    onBlur?: () => void
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

    return (
        <div class="reviewable" data-open={count() > 0 ? 'true' : undefined}>
            <Show when={count() > 0}>
                <span class="reviewable__margin t-meta" role="note">
                    {count() === 1 ? '1 open review request' : `${count()} open review requests`}
                </span>
            </Show>
            <MarkdownEditor
                label={props.label}
                placeholder={props.placeholder}
                value={props.value}
                readOnly={props.readOnly}
                onChange={props.onChange}
                onBlur={props.onBlur}
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
