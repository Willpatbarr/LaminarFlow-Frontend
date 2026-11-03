import { createEffect, createSignal, Show, untrack } from 'solid-js'

import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { TextArea } from '@/components/ui/TextArea'
import { createEpic, createMilestone, createSprint, sprintsForProject, sync } from '@/sync'

import { descriptionCount, nameCount, overMessage } from '../tickets/limits'
import { DateField } from './DateField'
import { DEFAULT_SPRINT_DAYS, defaultSprintEnd, defaultSprintStart, KINDS, localToday, type Kind } from './kinds'
import { sprintLengthDays } from './sprintLength'

type Created = { id: string; name: string }

type NewHierarchyDialogProps = {
    kind: Kind
    projectId: string
    /** Called with the new row (under its temporary id until the server answers),
     *  before the dialog closes. */
    onCreated?: (row: Created) => void
    onClose: () => void
}

// One dialog for the three, because they ask nearly the same thing: a name, and
// then the one or two fields that are theirs (an epic's description, a
// sprint's dates, a milestone's description and target date). The write goes to
// the local store, so it works offline; the row has a temporary id until the
// server answers, and a ticket can be filed under it at once (the engine sends
// the create first).
export function NewHierarchyDialog(props: NewHierarchyDialogProps) {
    const info = () => KINDS[props.kind]
    const [name, setName] = createSignal('')
    const [description, setDescription] = createSignal('')
    // A new sprint opens with dates (LAM-222): the start is today, or the day after
    // the latest sprint ends; the end is the start plus the team's sprint length.
    // The end follows the start until the user sets the end themselves.
    const [length, setLength] = createSignal(DEFAULT_SPRINT_DAYS)
    // Read once, as the dialog opens: sprints made while it is open do not move the start.
    const [start, setStart] = createSignal(
        untrack(() => (props.kind === 'sprint' ? defaultSprintStart(sprintsForProject(props.projectId), localToday()) : '')),
    )
    const [endChosen, setEnd] = createSignal<string | null>(null)
    const end = () => endChosen() ?? (props.kind === 'sprint' && start() ? defaultSprintEnd(start(), length()) : '')
    createEffect(
        () => (props.kind === 'sprint' ? sync.projects.find((project) => project.id === props.projectId)?.team_id : undefined),
        (teamId) => {
            if (!teamId) return
            let current = true
            void sprintLengthDays(teamId).then((days) => {
                if (current) setLength(days)
            })
            return () => {
                current = false
            }
        },
    )
    const [target, setTarget] = createSignal('')
    const [saving, setSaving] = createSignal(false)

    const nameOver = () => overMessage('Name', nameCount(name()))
    const descriptionOver = () => overMessage('Description', descriptionCount(description()))
    const datesBackwards = () =>
        props.kind === 'sprint' && start() !== '' && end() !== '' && end() < start() ? 'The end cannot be before the start.' : undefined
    const blocked = () =>
        saving() || name().trim() === '' || nameOver() !== undefined || descriptionOver() !== undefined || datesBackwards() !== undefined

    async function create() {
        if (blocked()) return
        setSaving(true)
        const project_id = props.projectId
        const text = name().trim()
        let row: Created
        try {
            row =
                props.kind === 'epic'
                    ? await createEpic({ project_id, name: text, description: description() })
                    : props.kind === 'sprint'
                      ? await createSprint({ project_id, name: text, start_date: start() || null, end_date: end() || null })
                      : await createMilestone({ project_id, name: text, description: description(), target_date: target() || null })
        } catch {
            // Nothing was made, so nothing is handed on; the dialog stays for another try.
            setSaving(false)
            return
        }
        props.onCreated?.(row)
        props.onClose()
    }

    return (
        <Modal
            title={`New ${info().singular}`}
            confirm={`Create ${info().singular}`}
            confirmDisabled={blocked()}
            onConfirm={() => void create()}
            onCancel={props.onClose}
        >
            <Input label="Name" value={name()} onInput={setName} required count={nameCount(name())} error={nameOver()} />
            <Show when={props.kind !== 'sprint'}>
                <TextArea
                    label="Description"
                    value={description()}
                    onInput={setDescription}
                    rows={3}
                    count={descriptionCount(description())}
                    error={descriptionOver()}
                />
            </Show>
            <Show when={props.kind === 'sprint'}>
                <DateField label="Start date" value={start()} onInput={setStart} />
                <DateField label="End date" value={end()} onInput={setEnd} error={datesBackwards()} />
            </Show>
            <Show when={props.kind === 'milestone'}>
                <DateField label="Target date" value={target()} onInput={setTarget} />
            </Show>
        </Modal>
    )
}
