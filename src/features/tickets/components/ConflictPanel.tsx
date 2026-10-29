import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { Status, TicketConflict, TicketFields } from '@/sync'

import type { Viewer } from '../viewer'
import { RelativeTime } from './RelativeTime'
import './conflict.css'

type ConflictPanelProps = {
    /** What the user's parked change was: an edit, or an archive. */
    kind: 'update' | 'archive'
    /** What the 409 said: the server's copy and who changed it, and when. */
    conflict: TicketConflict
    /** The user's version: the ticket as it stands here, their edits included. */
    mine: TicketFields
    statuses: Status[]
    viewer: Viewer
    /** Each resolves once it has been carried out. The page decides what comes
     *  after (where focus goes, what is announced, where to navigate). */
    onKeepTheirs: () => Promise<unknown>
    onUseMine: () => Promise<unknown>
    onKeepAsNew: () => Promise<unknown>
}

type Difference = { field: string; mine: string; theirs: string }

// The panel on a ticket page whose parked change collided with someone else's.
// It is information with three honest ways forward, not an error: nothing is
// lost, so it is neutral in colour and wording, a labelled region rather than
// an alert, and none of its buttons is a danger button. "Keep theirs" is the
// primary one: it is the safe default (the server's copy stands, and a
// confirmation guards any words it would set aside), while "Keep mine as a new
// ticket" is the rarest choice.
//
// The comparison is plain text, field by field, and only for fields that
// differ. There is no merge and no diff: the user picks a side, or keeps their
// side as a ticket of its own.
export function ConflictPanel(props: ConflictPanelProps) {
    const headingId = createUniqueId()
    const noteId = createUniqueId()
    const [confirming, setConfirming] = createSignal(false)
    const [busy, setBusy] = createSignal(false)

    const archived = () => props.conflict.code === 'ticket_archived'
    const theirs = () => props.conflict.current

    // Whether this is a person we can name, or us in another tab, or no one.
    const who = () => props.conflict.changed_by
    const itWasMe = () => who()?.account_id === props.viewer.accountId

    function statusName(id: string | null) {
        if (!id) return 'No status'
        return props.statuses.find((status) => status.id === id)?.name ?? 'Unknown status'
    }

    function assigneeName(id: string | null) {
        if (!id) return 'Unassigned'
        if (id === props.viewer.accountId) return 'You'
        const changer = who()
        return changer && changer.account_id === id ? changer.display_name : 'Someone else'
    }

    // For an archive there is no version of the user's to set beside theirs:
    // they changed nothing, the ticket changed under them.
    const differences = createMemo<Difference[]>(() => {
        if (props.kind === 'archive') return []
        const mine = props.mine
        const other = theirs()
        const found: Difference[] = []
        if (mine.title !== other.title) {
            found.push({ field: 'Title', mine: mine.title, theirs: other.title })
        }
        if (mine.description !== other.description) {
            found.push({ field: 'Description', mine: mine.description, theirs: other.description })
        }
        if (mine.status_id !== other.status_id) {
            found.push({
                field: 'Status',
                mine: statusName(mine.status_id),
                theirs: statusName(other.status_id),
            })
        }
        if (mine.assignee_id !== other.assignee_id) {
            found.push({
                field: 'Assignee',
                mine: assigneeName(mine.assignee_id),
                theirs: assigneeName(other.assignee_id),
            })
        }
        return found
    })

    // Words only this side has would be gone for good: the title or the
    // description. A different status or assignee is one click to put back.
    const loses = createMemo(() => {
        if (props.kind === 'archive') return []
        const lost: string[] = []
        if (props.mine.title !== theirs().title) lost.push('title')
        if (props.mine.description !== theirs().description) lost.push('description')
        return lost
    })

    async function run(action: () => Promise<unknown>) {
        setBusy(true)
        try {
            await action()
        } finally {
            setBusy(false)
        }
    }

    const keepTheirsLabel = () => (archived() ? 'Discard my change' : 'Keep theirs')

    return (
        <section class="conflict" role="region" aria-labelledby={headingId}>
            <h2 id={headingId} class="conflict__title t-section">
                This ticket needs a decision
            </h2>

            <p class="t-body">
                <Show
                    when={who()}
                    fallback={
                        <>
                            This ticket was {archived() ? 'archived' : 'edited'}{' '}
                            <RelativeTime at={props.conflict.changed_at} />.
                        </>
                    }
                >
                    {(changer) => (
                        <>
                            {itWasMe() ? 'You' : changer().display_name || 'Someone'}{' '}
                            {archived() ? 'archived' : 'edited'} this ticket
                            {itWasMe() ? ' somewhere else' : ''}{' '}
                            <RelativeTime at={props.conflict.changed_at} />.
                        </>
                    )}
                </Show>
            </p>
            <p class="t-body">Your change hasn't been saved to the server. It's still here.</p>

            <Show when={props.kind === 'archive'}>
                <p class="t-body">
                    You archived this ticket. What is shown below is their version of it.
                </p>
            </Show>

            <Show when={differences().length > 0}>
                <div class="conflict__fields" role="group" aria-label="What differs">
                    <For each={differences()}>
                        {(difference) => (
                            <div class="conflict__field">
                                <h3 class="conflict__field-name t-overline">{difference.field}</h3>
                                <div class="conflict__pair">
                                    <Side label="Your version" value={difference.mine} />
                                    <Side label="Their version" value={difference.theirs} />
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
            <Show when={props.kind === 'update' && differences().length === 0}>
                <p class="t-meta">Your version and theirs read the same.</p>
            </Show>

            <p class="t-meta">
                Editing is paused until you decide, so nothing more is added to a version that
                may be set aside.
            </p>

            <div class="conflict__actions">
                <Button
                    variant="primary"
                    disabled={busy()}
                    onClick={() => {
                        if (loses().length > 0) setConfirming(true)
                        else void run(props.onKeepTheirs)
                    }}
                >
                    {keepTheirsLabel()}
                </Button>
                <Show when={!archived()}>
                    <Button
                        variant="secondary"
                        disabled={busy()}
                        describedBy={noteId}
                        onClick={() => void run(props.onUseMine)}
                    >
                        {props.kind === 'archive' ? 'Archive anyway' : 'Use mine'}
                    </Button>
                </Show>
                <Show when={props.kind === 'update'}>
                    <Button
                        variant="secondary"
                        disabled={busy()}
                        onClick={() => void run(props.onKeepAsNew)}
                    >
                        Keep mine as a new ticket
                    </Button>
                </Show>
            </div>
            <Show when={!archived()}>
                <p id={noteId} class="conflict__note t-meta">
                    {props.kind === 'archive'
                        ? 'Archive anyway archives the ticket as it is now, with their change in it.'
                        : 'Use mine replaces their change with yours.'}
                </p>
            </Show>

            <Show when={confirming()}>
                <Modal
                    title="Set your version aside?"
                    consequence={`Your ${loses().join(' and ')} ${loses().length > 1 ? 'are' : 'is'} not kept. To keep ${loses().length > 1 ? 'them' : 'it'}, choose “Keep mine as a new ticket” instead.`}
                    confirm={keepTheirsLabel()}
                    onConfirm={() => {
                        setConfirming(false)
                        void run(props.onKeepTheirs)
                    }}
                    onCancel={() => setConfirming(false)}
                />
            </Show>
        </section>
    )
}

type SideProps = { label: string; value: string }

function Side(props: SideProps) {
    return (
        <div class="conflict__side">
            <span class="conflict__side-label t-meta">{props.label}</span>
            <Show
                when={props.value !== ''}
                fallback={<p class="conflict__value conflict__value--empty t-body">Empty</p>}
            >
                <p class="conflict__value t-body">{props.value}</p>
            </Show>
        </div>
    )
}
