import { createSignal, Show } from 'solid-js'

import { classify } from '@/api/errors'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createProject, createTeam } from '@/sync'

import { describeSetupFailure, refusedName } from '../tickets/components/FirstRunSetup'
import { nameCount, overMessage } from '../tickets/limits'
import { nameProblem } from './contextActions'

type NewContextDialogProps =
    | { kind: 'team'; workspaceId: string; onCreated: (id: string) => void; onClose: () => void }
    | { kind: 'project'; teamId: string; teamName: string; onCreated: (id: string) => void; onClose: () => void }

// One dialog for the two, as NewHierarchyDialog is for epic, sprint and milestone: a name,
// Enter creates, Escape cancels. The calls are the store's direct ones (they need a connection),
// so the server's answer is shown here: a refused name on the field, anything else under it.
export function NewContextDialog(props: NewContextDialogProps) {
    const noun = () => (props.kind === 'team' ? 'Team' : 'Project')
    const [name, setName] = createSignal('')
    const [saving, setSaving] = createSignal(false)
    const [refused, setRefused] = createSignal<string>()
    const [failure, setFailure] = createSignal<string>()

    const problem = () => nameProblem(noun(), name())
    const fieldError = () => overMessage(`${noun()} name`, nameCount(name())) ?? refused()
    const blocked = () => saving() || problem() !== undefined || overMessage('Name', nameCount(name())) !== undefined

    async function create() {
        if (blocked()) return
        setSaving(true)
        setRefused(undefined)
        setFailure(undefined)
        try {
            const text = name().trim()
            const row =
                props.kind === 'team' ? await createTeam(props.workspaceId, text) : await createProject(props.teamId, text)
            props.onCreated(row.id)
            props.onClose()
        } catch (error) {
            const lower = noun().toLowerCase()
            if (classify(error) === 'conflict') setRefused(`A ${lower} with this name already exists. Choose another name.`)
            else {
                const named = refusedName(error, `${lower} name`)
                if (named) setRefused(named)
                else setFailure(describeSetupFailure(error))
            }
            setSaving(false)
        }
    }

    return (
        <Modal
            title={props.kind === 'team' ? 'New team' : `New project in ${props.kind === 'project' ? props.teamName : ''}`}
            confirm={`Create ${props.kind}`}
            confirmDisabled={blocked()}
            onConfirm={() => void create()}
            onCancel={props.onClose}
        >
            <Input
                label="Name"
                value={name()}
                onInput={(value) => {
                    setName(value)
                    setRefused(undefined)
                }}
                required
                count={nameCount(name())}
                error={fieldError()}
            />
            <Show when={failure()}>
                <p class="t-meta" role="alert">
                    {failure()}
                </p>
            </Show>
        </Modal>
    )
}
