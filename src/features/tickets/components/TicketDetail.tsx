import { useNavigate } from '@solidjs/router'
import {
    createEffect,
    createMemo,
    createSignal,
    createUniqueId,
    For,
    Match,
    Show,
    Switch,
    untrack,
} from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { SkeletonBox, SkeletonLine } from '@/components/ui/Skeleton'
import { TextArea } from '@/components/ui/TextArea'
import {
    archiveOnHold,
    discard,
    epicsForProject,
    labelsForProject,
    milestonesForProject,
    sprintsForProject,
    isLoading,
    keepAsNew,
    resolveTicketId,
    retry,
    statusesForProject,
    sync,
    ticketById,
    ticketHead,
    ticketSyncState,
    updateTicket,
    type Ticket,
} from '@/sync'

import { NewHierarchyDialog } from '@/features/hierarchy/NewHierarchyDialog'
import type { Kind } from '@/features/hierarchy/kinds'
import { describeFailure } from '../entryFailure'
import { BLANK_TITLE, descriptionCount, overMessage, titleCount } from '../limits'
import type { Viewer } from '../viewer'
import { archiveWithUndo } from './ArchiveUndoToast'
import { ConflictPanel } from './ConflictPanel'
import { LabelChips } from './LabelChips'
import { NewLabel } from './LabelEditor'
import { SyncMarker } from './SyncMarker'
import './tickets.css'

type TicketDetailProps = {
    /** Set when the page is drawn as the side panel beside the list: the way
     *  back is then a Close button, not a link to the list. */
    onClose?: () => void
    /** From the URL. May be a temporary id, or one that has since been replaced. */
    id: string
    viewer: Viewer
    /** Force the placeholder, whatever the store says. See TicketList. */
    loading?: boolean
}

// The ticket page at /tickets/:id.
//
// A ticket created offline is opened under a temporary id. When the server
// answers, the store renames the row in place and remembers old -> new, so
// `ticketById` keeps returning the SAME row for either id: nothing here
// re-mounts, a field being typed in keeps its focus and its text, and the only
// visible change is the address bar, which is replaced (not pushed) below.
//
// While the first load is on its way (or `loading` says so) it draws the form's
// own shape - a label over a field, in the same places - instead of "not
// found": a ticket that has not arrived yet is not a ticket that is missing.
export function TicketDetail(props: TicketDetailProps) {
    const navigate = useNavigate()
    const ticket = createMemo(() => ticketById(props.id))
    const busy = () => props.loading || isLoading()

    // What the last resolved conflict did, said in a polite status region that
    // lives here rather than in the editor: the editor is gone by the time a
    // discarded ticket is, and is reused when the page moves on to the copy.
    const [notice, setNotice] = createSignal('')
    let noticeEl: HTMLDivElement | undefined
    const announce: Announce = (text, options) => {
        setNotice(text)
        // Focus follows the news when the thing that had it is gone.
        if (options?.focus) noticeEl?.focus()
    }

    createEffect(
        () => resolveTicketId(props.id),
        (resolved) => {
            if (resolved !== untrack(() => props.id)) {
                navigate(`/tickets/${resolved}`, { replace: true })
            }
        },
    )

    return (
        <section class="tickets ticket" aria-busy={busy() ? 'true' : undefined}>
            <Show
                when={props.onClose}
                fallback={
                    <p class="t-meta">
                        <a href="/">← Tickets</a>
                    </p>
                }
            >
                {(close) => (
                    <p class="t-meta ticket__bar">
                        <a href={`/tickets/${props.id}`}>Open as a page</a>
                        <Button variant="ghost" size="sm" onClick={() => close()()}>
                            Close
                        </Button>
                    </p>
                )}
            </Show>
            <div
                ref={(el) => {
                    noticeEl = el
                }}
                class="ticket__notice t-body"
                aria-live="polite"
                aria-atomic="true"
                tabindex="-1"
            >
                {notice()}
            </div>
            <Switch
                fallback={
                    <>
                        <h1 class="t-screen-title">Ticket not found</h1>
                        <p class="t-body">
                            It may have been archived, or the address may be wrong.
                        </p>
                    </>
                }
            >
                <Match when={busy()}>
                    <LoadingTicket />
                </Match>
                <Match when={ticket()}>
                    {(found) => (
                        <TicketEditor ticket={found()} viewer={props.viewer} announce={announce} />
                    )}
                </Match>
            </Switch>
        </section>
    )
}

// The editor's shape, field for field: the same `.ticket__form` and `.input`
// boxes, with a bar where each label is and a box where each control is. The
// heights are the real controls' (a one-line field, the six-row description,
// the button), so nothing moves when the ticket lands.
function LoadingTicket() {
    return (
        <>
            {/* The one announcement, outside the hidden placeholder. */}
            <p class="visually-hidden" role="status">
                Loading ticket…
            </p>
            <div class="ticket__form" aria-hidden="true">
                <div class="ticket__status-line" />
                <PlaceholderField control="40px" />
                <PlaceholderField control="150px" />
                <div class="ticket__row">
                    <PlaceholderField control="40px" />
                    <PlaceholderField control="40px" />
                </div>
                <div class="ticket__row">
                    <PlaceholderField control="40px" />
                    <PlaceholderField control="40px" />
                </div>
                <div class="ticket__row">
                    <PlaceholderField control="40px" />
                </div>
                <div class="ticket__new-parent">
                    <SkeletonBox shape="control" width="72px" height="26px" />
                    <SkeletonBox shape="control" width="82px" height="26px" />
                    <SkeletonBox shape="control" width="98px" height="26px" />
                </div>
                <div class="ticket__labels">
                    <span class="input__label t-body ticket__skeleton-line">
                        <SkeletonLine width="7ch" height="12px" />
                    </span>
                    <PlaceholderField control="40px" />
                    <PlaceholderField control="40px" />
                </div>
                <div class="t-meta ticket__hint ticket__skeleton-line">
                    <SkeletonLine width="28ch" height="11px" />
                </div>
                <div class="ticket__danger">
                    <SkeletonBox shape="control" width="119px" height="31.5px" />
                </div>
            </div>
        </>
    )
}

type PlaceholderFieldProps = {
    /** The height of the control it stands in for. */
    control: `${number}px`
}

function PlaceholderField(props: PlaceholderFieldProps) {
    return (
        <div class="input">
            <span class="input__label t-body ticket__skeleton-line">
                <SkeletonLine width="9ch" height="12px" />
            </span>
            <SkeletonBox shape="control" height={props.control} />
        </div>
    )
}

// A text field that saves when focus leaves it. While the user is typing, the
// field shows their draft and ignores the store, so a sync landing mid-word
// cannot overwrite it; once the store shows what was typed, the draft is
// dropped and the field follows the store again.
function createDraft(saved: () => string, save: (value: string) => Promise<unknown>) {
    const [draft, setDraft] = createSignal<string | null>(null)
    return {
        value: () => draft() ?? saved(),
        input: (value: string) => {
            setDraft(value)
        },
        async commit() {
            const value = draft()
            if (value === null) return
            if (value !== saved()) await save(value)
            // Unless they have started typing again in the meantime.
            if (draft() === value) setDraft(null)
        },
        reset: () => {
            setDraft(null)
        },
    }
}

type Announce = (text: string, options?: { focus?: boolean }) => void

type TicketEditorProps = {
    ticket: Ticket
    viewer: Viewer
    announce: Announce
}

// HOW IT SAVES: there is no Save button. Title and description save when focus
// leaves the field (and the title also on Enter); status and assignee save the
// moment they change. Every save is a write to the local store, so it never
// waits and never fails here - what the server makes of it shows in the marker.
//
// WHEN THE SERVER REFUSES IT (422, 403, 404 ...): the entry is parked as
// `failed` and this page says so, at the field when the server named one. The
// text on screen is still the user's - the row is the server's copy with their
// entry replayed on top - and editing a field and leaving it folds the new
// value into that same entry and sends it again (the engine's `updateTicket`
// does that for a failed head), so there is nothing here to "reopen".
//
// WHEN SOMEONE ELSE GOT THERE FIRST (409): the entry is parked as `conflict`
// and the ConflictPanel asks which version stands. Until it is answered the
// fields are read-only - more edits would only pile onto a version that may be
// set aside - and an archive that collided keeps the ticket on screen, locked,
// for the same reason.
function TicketEditor(props: TicketEditorProps) {
    const navigate = useNavigate()
    const [confirmingArchive, setConfirmingArchive] = createSignal(false)
    // The epic, sprint or milestone being made from this page (LAM-105): made
    // here, it is given to this ticket in the same step.
    const [makingParent, setMakingParent] = createSignal<Kind | null>(null)
    const assigneeLabelId = createUniqueId()

    const id = () => props.ticket.id
    const statuses = createMemo(() => statusesForProject(props.ticket.project_id))

    let titleEl: HTMLInputElement | undefined

    const title = createDraft(
        () => props.ticket.title,
        (value) => updateTicket(id(), { title: value.trim() }),
    )
    const description = createDraft(
        () => props.ticket.description,
        (value) => updateTicket(id(), { description: value }),
    )

    // Nothing over its limit, and no blank title, is ever queued. The text
    // stays in the field with the reason beside it - the same place a refusal
    // from the server puts it, so there is one place to look. The server's own
    // 422 is still the authority and still lands on the field (`refused`).
    const [blankTried, setBlankTried] = createSignal(false)
    const titleOver = () => overMessage('Title', titleCount(title.value()))
    const descriptionOver = () => overMessage('Description', descriptionCount(description.value()))
    const titleError = () =>
        titleOver() ??
        (blankTried() && title.value().trim() === '' ? BLANK_TITLE : undefined) ??
        refused()?.fields.title
    const descriptionError = () => descriptionOver() ?? refused()?.fields.description

    function commitTitle() {
        // A ticket with no title is a row nobody can find again.
        if (title.value().trim() === '') {
            setBlankTried(true)
            return
        }
        if (titleOver()) return
        void title.commit()
    }

    function commitDescription() {
        if (descriptionOver()) return
        void description.commit()
    }

    const statusOptions = () => {
        const options = statuses().map((status) => ({ value: status.id, label: status.name }))
        // A status this team no longer has is still the ticket's until someone
        // changes it; without its own option the select would show a lie.
        const current = props.ticket.status_id
        if (current && !options.some((option) => option.value === current)) {
            options.push({ value: current, label: 'Unknown status' })
        }
        return [{ value: '', label: 'No status' }, ...options]
    }

    // A parent, sprint or milestone that is no longer in the list is still the
    // ticket's until someone changes it, so it keeps an option of its own (as a
    // status does); "None" is the empty value and never an error.
    function pickerOptions<T extends { id: string; name: string }>(known: T[], current: string[], unknown: string) {
        const options = known.map((item) => ({ value: item.id, label: item.name }))
        for (const id of current) {
            if (!options.some((option) => option.value === id)) options.push({ value: id, label: unknown })
        }
        return [{ value: '', label: 'None' }, ...options]
    }
    const project = () => props.ticket.project_id
    const epicOptions = () => pickerOptions(epicsForProject(project()), props.ticket.epic_id ? [props.ticket.epic_id] : [], 'Unknown epic')
    const milestoneOptions = () =>
        pickerOptions(milestonesForProject(project()), props.ticket.milestone_id ? [props.ticket.milestone_id] : [], 'Unknown milestone')
    const sprintOptions = () => pickerOptions(sprintsForProject(project()), props.ticket.sprint_ids.slice(0, 1), 'Unknown sprint')
    const teamId = () => sync.projects.find((candidate) => candidate.id === project())?.team_id ?? ''
    const labelChoices = () => {
        const known = labelsForProject(project())
        const unknown = props.ticket.label_ids
            .filter((id) => !known.some((label) => label.id === id))
            .map((id) => ({ id, name: 'Unknown label', color: '' }))
        return [...known, ...unknown]
    }
    // Two boxes ticked in quick succession must both count: the second is
    // worked out from the first even though the store has not shown it yet.
    const [labelDraft, setLabelDraft] = createSignal<string[] | null>(null)
    const labelIds = () => labelDraft() ?? props.ticket.label_ids
    async function toggleLabel(labelId: string, on: boolean) {
        const next = labelIds().filter((other) => other !== labelId)
        if (on) next.push(labelId)
        next.sort()
        setLabelDraft(next)
        await updateTicket(id(), { label_ids: next })
        // Unless another tick has come in meanwhile.
        if (labelDraft() === next) setLabelDraft(null)
    }

    // The refusal, if the head of this ticket's queue is one. Read through the
    // store so it appears and goes as the engine parks and unparks the entry.
    const refused = createMemo(() => {
        const head = ticketHead(id())
        return head?.state === 'failed' && head.error
            ? {
                  entryId: head.id,
                  // What was sent, for a refusal that cannot say which field.
                  ...describeFailure(head.error, head.kind === 'archive' ? undefined : head.payload),
              }
            : null
    })

    // The parked change that collided with someone else's, if the head of the
    // queue is one: just enough of it for the panel and the actions.
    const conflicted = createMemo(() => {
        const head = ticketHead(id())
        return head?.state === 'conflict' && head.conflict
            ? {
                  entryId: head.id,
                  kind: head.kind === 'archive' ? ('archive' as const) : ('update' as const),
                  conflict: head.conflict,
              }
            : null
    })
    // Read-only: a collision to decide, or an archive that did not go through.
    const locked = () => conflicted() !== null || archiveOnHold(id())

    function focusTitle() {
        titleEl?.focus()
    }

    async function keepTheirs() {
        const found = conflicted()
        if (!found) return
        await discard(found.entryId)
        if (found.conflict.code === 'ticket_archived') {
            // The ticket is gone for good, and so is this form.
            props.announce(
                "Discarded your change. The ticket was archived, so it's no longer in your list.",
                { focus: true },
            )
        } else {
            props.announce('Kept their version. Your change was discarded.')
            focusTitle()
        }
    }

    // "Use mine" is sent, and may collide again; the panel then simply shows
    // the new situation. `waitingFor` is the entry whose answer we are waiting
    // to hear, so the page can say what became of it.
    let waitingFor: number | null = null
    async function useMine() {
        const found = conflicted()
        if (!found) return
        if (found.kind === 'archive') {
            // As archiving does: leave first, the row is about to disappear.
            navigate('/')
            await retry(found.entryId)
            return
        }
        waitingFor = found.entryId
        props.announce('Sending your version.')
        await retry(found.entryId)
    }

    createEffect(
        () => {
            const head = ticketHead(id())
            return head ? `${head.id}:${head.state}:${head.conflict?.changed_at ?? ''}` : 'none'
        },
        () => {
            if (waitingFor === null) return
            // Everything below reads the store, and none of it should re-run
            // this: the compute half above is what says when.
            untrack(() => {
                const head = ticketHead(id())
                if (head?.id === waitingFor) {
                    if (head.state === 'conflict') {
                        waitingFor = null
                        props.announce(
                            "That didn't go through: the ticket changed again. Your version still hasn't been saved.",
                        )
                    } else if (head.state !== 'pending') {
                        // Refused or signed out: those have their own words.
                        waitingFor = null
                    }
                    return
                }
                waitingFor = null
                props.announce('Saved. Your version replaced theirs.')
                focusTitle()
            })
        },
    )

    async function keepMineAsNew() {
        const found = conflicted()
        if (!found) return
        const copy = await keepAsNew(found.entryId)
        if (!copy) return
        navigate(`/tickets/${copy}`)
        props.announce(
            found.conflict.code === 'ticket_archived'
                ? 'Saved your version as a new ticket. The original stays archived.'
                : 'Saved your version as a new ticket. The original is back to their version.',
            { focus: true },
        )
    }

    const assignedToMe = () => props.ticket.assignee_id === props.viewer.accountId
    const assignedElsewhere = () => props.ticket.assignee_id !== null && !assignedToMe()

    function archive() {
        // Leave first: the row disappears the moment it is archived, and this
        // page would show "not found" for a frame on the way out.
        const archiving = { ...props.ticket }
        setConfirmingArchive(false)
        navigate('/')
        void archiveWithUndo(archiving)
    }

    return (
        <form
            class="ticket__form"
            onSubmit={(event) => {
                // Enter in the title: save it, do not reload the page.
                event.preventDefault()
                commitTitle()
            }}
        >
            <div class="ticket__status-line" role="status">
                <SyncMarker state={ticketSyncState(id())} withText />
            </div>

            <Show when={refused()}>
                {(failure) => (
                    <div class="ticket__failure" role="alert">
                        <Show
                            when={failure().fieldShaped}
                            fallback={<p class="t-body">{failure().form}</p>}
                        >
                            <p class="t-body">
                                The server didn't accept this change. Fix the marked field and
                                it will send again.
                            </p>
                            <Show when={failure().form}>
                                <p class="t-meta">{failure().form}</p>
                            </Show>
                        </Show>
                        <div>
                            <Button variant="secondary" onClick={() => void discard(failure().entryId)}>
                                Discard my change
                            </Button>
                        </div>
                    </div>
                )}
            </Show>

            <Show when={conflicted()}>
                {(found) => (
                    <ConflictPanel
                        kind={found().kind}
                        conflict={found().conflict}
                        mine={props.ticket}
                        statuses={statuses()}
                        viewer={props.viewer}
                        onKeepTheirs={keepTheirs}
                        onUseMine={useMine}
                        onKeepAsNew={keepMineAsNew}
                    />
                )}
            </Show>

            <Input
                label="Title"
                ref={(el) => {
                    titleEl = el
                }}
                readOnly={locked()}
                value={title.value()}
                onInput={(value) => {
                    setBlankTried(false)
                    title.input(value)
                }}
                onBlur={commitTitle}
                count={titleCount(title.value())}
                error={titleError()}
            />

            <TextArea
                label="Description"
                readOnly={locked()}
                value={description.value()}
                onInput={description.input}
                onBlur={commitDescription}
                count={descriptionCount(description.value())}
                error={descriptionError()}
            />

            <div class="ticket__row">
                <Select
                    label="Status"
                    value={props.ticket.status_id ?? ''}
                    options={statusOptions()}
                    disabled={locked()}
                    onChange={(value) => void updateTicket(id(), { status_id: value || null })}
                    error={refused()?.fields.status}
                />

                <div class="input">
                    <span class="input__label t-body" id={assigneeLabelId}>
                        Assignee
                    </span>
                    <div class="ticket__assignee" role="group" aria-labelledby={assigneeLabelId}>
                        <Show
                            when={!assignedElsewhere()}
                            fallback={<span class="t-body">Someone else</span>}
                        >
                            <span class="t-body">{assignedToMe() ? 'You' : 'Unassigned'}</span>
                            <Button
                                variant="secondary"
                                disabled={locked()}
                                onClick={() =>
                                    void updateTicket(id(), {
                                        assignee_id: assignedToMe() ? null : props.viewer.accountId,
                                    })
                                }
                            >
                                {assignedToMe() ? 'Unassign' : 'Assign to me'}
                            </Button>
                        </Show>
                    </div>
                    <Show when={refused()?.fields.assignee}>
                        <span class="input__error t-meta">{refused()?.fields.assignee}</span>
                    </Show>
                </div>
            </div>

            <div class="ticket__row">
                <Select
                    label="Epic"
                    value={props.ticket.epic_id ?? ''}
                    options={epicOptions()}
                    disabled={locked()}
                    onChange={(value) => void updateTicket(id(), { epic_id: value || null })}
                    error={refused()?.fields.epic}
                />
                <Select
                    label="Sprint"
                    value={props.ticket.sprint_ids[0] ?? ''}
                    options={sprintOptions()}
                    disabled={locked()}
                    onChange={(value) => void updateTicket(id(), { sprint_ids: value ? [value] : [] })}
                />
            </div>

            <div class="ticket__row">
                <Select
                    label="Milestone"
                    value={props.ticket.milestone_id ?? ''}
                    options={milestoneOptions()}
                    disabled={locked()}
                    onChange={(value) => void updateTicket(id(), { milestone_id: value || null })}
                    error={refused()?.fields.milestone}
                />
            </div>

            <div class="ticket__new-parent">
                <Button variant="ghost" size="sm" disabled={locked()} onClick={() => setMakingParent('epic')}>
                    New epic
                </Button>
                <Button variant="ghost" size="sm" disabled={locked()} onClick={() => setMakingParent('sprint')}>
                    New sprint
                </Button>
                <Button variant="ghost" size="sm" disabled={locked()} onClick={() => setMakingParent('milestone')}>
                    New milestone
                </Button>
            </div>
            <Show when={makingParent()}>
                {(kind) => (
                    <NewHierarchyDialog
                        kind={kind()}
                        projectId={project()}
                        onCreated={(row) => {
                            if (kind() === 'epic') void updateTicket(id(), { epic_id: row.id })
                            else if (kind() === 'milestone') void updateTicket(id(), { milestone_id: row.id })
                            else void updateTicket(id(), { sprint_ids: [...props.ticket.sprint_ids, row.id] })
                        }}
                        onClose={() => setMakingParent(null)}
                    />
                )}
            </Show>

            <fieldset class="ticket__labels" disabled={locked()}>
                <legend class="input__label t-body">Labels</legend>
                <LabelChips ids={labelIds()} />
                <Show
                    when={labelChoices().length > 0}
                    fallback={<span class="t-body ticket__none">None</span>}
                >
                    <For each={labelChoices()}>
                        {(label) => (
                            <label class="ticket__label t-body">
                                <input
                                    type="checkbox"
                                    checked={labelIds().includes(label.id)}
                                    onChange={(event) => void toggleLabel(label.id, event.currentTarget.checked)}
                                />
                                <span
                                    class="ticket__label-dot"
                                    aria-hidden="true"
                                    style={{ background: label.color || 'var(--text-3)' }}
                                />
                                {label.name}
                            </label>
                        )}
                    </For>
                </Show>
                {/* Make a label here and give it to this ticket in one step. */}
                <Show when={teamId()}>
                    <NewLabel
                        teamId={teamId()}
                        confirm="Create and apply"
                        onAdd={(label) => {
                            if (!labelIds().includes(label.id)) void toggleLabel(label.id, true)
                        }}
                    />
                </Show>
                <Show when={refused()?.fields.labels}>
                    <span class="input__error t-meta">{refused()?.fields.labels}</span>
                </Show>
            </fieldset>

            <p class="t-meta ticket__hint">
                {locked() && !conflicted()
                    ? 'Editing is paused until you deal with the archive that did not go through.'
                    : 'Changes are saved as you make them.'}
            </p>

            <div class="ticket__danger">
                <Button
                    variant="danger"
                    disabled={locked()}
                    onClick={() => setConfirmingArchive(true)}
                >
                    Archive ticket
                </Button>
            </div>

            <Show when={confirmingArchive()}>
                <Modal
                    title={`Archive “${props.ticket.title || 'Untitled'}”?`}
                    consequence="It leaves the list for everyone. Its comments are kept."
                    confirm="Archive"
                    destructive
                    onConfirm={archive}
                    onCancel={() => setConfirmingArchive(false)}
                />
            </Show>
        </form>
    )
}
