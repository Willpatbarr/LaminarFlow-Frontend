import { createSignal, Show } from 'solid-js'

import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { TextArea } from '@/components/ui/TextArea'
import { createEpic, createMilestone, createSprint } from '@/sync'

import { descriptionCount, nameCount, overMessage } from '../tickets/limits'
import { KINDS, type Kind } from './kinds'

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
    const [start, setStart] = createSignal('')
    const [end, setEnd] = createSignal('')
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
        const row =
            props.kind === 'epic'
                ? await createEpic({ project_id, name: text, description: description() })
                : props.kind === 'sprint'
                  ? await createSprint({ project_id, name: text, start_date: start() || null, end_date: end() || null })
                  : await createMilestone({ project_id, name: text, description: description(), target_date: target() || null })
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
                <Input label="Start date" type="date" value={start()} onInput={setStart} />
                <Input label="End date" type="date" value={end()} onInput={setEnd} error={datesBackwards()} />
            </Show>
            <Show when={props.kind === 'milestone'}>
                <Input label="Target date" type="date" value={target()} onInput={setTarget} />
            </Show>
        </Modal>
    )
}
