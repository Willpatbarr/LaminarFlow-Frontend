import { createSignal, For, onSettled, Show } from 'solid-js'

import { Modal } from '@/components/ui/Modal'
import { TextArea } from '@/components/ui/TextArea'
import { loadMembers, members } from '@/features/members/members'

import { createReviewRequest, type ReviewRequest } from './api'

/*
┌─ review ────────────────────────────────────────
│  the dialog behind "Request review": a note and the people to ask
├─ out ───────────────────────────────────────────
│      RequestReviewDialog   <RequestReviewDialog quote range accountId documentId fieldId onDone onClose />
*/
// Mount to open, unmount to close (like Modal). The same Idempotency-Key is
// used for every attempt made from one opening, so pressing the button again
// after a lost answer cannot ask twice.

export const REVIEWERS_MAX = 50
const NOTE_MAX = 50_000

type Props = {
    documentId: string
    fieldId: string | null
    /** The text being asked about, as quoted back to the person. */
    quote: string
    /** Code point offsets into the field's stored Markdown. */
    start: number
    end: number
    /** The signed-in account: not offered, since they are the one asking. */
    accountId: string
    onDone: (request: ReviewRequest) => void
    onClose: () => void
}

export function RequestReviewDialog(props: Props) {
    const key = crypto.randomUUID()
    const [note, setNote] = createSignal('')
    const [chosen, setChosen] = createSignal<string[]>([])
    const [busy, setBusy] = createSignal(false)
    const [problem, setProblem] = createSignal('')
    const [unavailable, setUnavailable] = createSignal(false)

    onSettled(() => {
        void loadMembers().then((found) => setUnavailable(!found && members().length === 0))
    })

    const people = () =>
        members()
            .filter((member) => member.account_id !== props.accountId)
            .toSorted((a, b) => a.display_name.localeCompare(b.display_name))
    const toggle = (id: string) =>
        setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
    const valid = () => note().trim() !== '' && chosen().length > 0 && chosen().length <= REVIEWERS_MAX && [...note()].length <= NOTE_MAX

    async function send() {
        if (!valid() || busy()) return
        setBusy(true)
        setProblem('')
        const result = await createReviewRequest({
            documentId: props.documentId,
            fieldId: props.fieldId,
            start: props.start,
            end: props.end,
            note: note().trim(),
            reviewerIds: chosen(),
            idempotencyKey: key,
        })
        setBusy(false)
        if (result.ok) props.onDone(result.data)
        else setProblem(result.message)
    }

    return (
        <Modal
            title="Request a review"
            confirm="Request review"
            cancel="Cancel"
            confirmDisabled={!valid() || busy()}
            onConfirm={() => void send()}
            onCancel={props.onClose}
        >
            <div class="review-dialog">
                <blockquote class="review-quote t-body">{props.quote}</blockquote>
                <TextArea
                    label="Note for the reviewers"
                    rows={3}
                    value={note()}
                    onInput={setNote}
                    placeholder="What would you like them to look at?"
                />
                <fieldset class="review-dialog__people">
                    <legend class="t-body">Reviewers</legend>
                    <Show when={!unavailable()} fallback={<p class="t-meta">Could not load the people in this workspace. Check the connection and try again.</p>}>
                        <Show when={people().length > 0} fallback={<p class="t-meta">No one else is in this workspace yet.</p>}>
                            <For each={people()}>
                                {(member) => (
                                    <label class="review-dialog__person t-body">
                                        <input
                                            type="checkbox"
                                            checked={chosen().includes(member.account_id)}
                                            onChange={() => toggle(member.account_id)}
                                        />
                                        <span>{member.display_name}</span>
                                        <span class="t-meta">{member.email}</span>
                                    </label>
                                )}
                            </For>
                        </Show>
                    </Show>
                </fieldset>
                <Show when={problem()}>
                    <p class="review-dialog__problem t-body" role="alert">
                        {problem()}
                    </p>
                </Show>
            </div>
        </Modal>
    )
}
