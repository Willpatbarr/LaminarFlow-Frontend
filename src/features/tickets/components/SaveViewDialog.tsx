import { createSignal } from 'solid-js'

import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

import { codePoints, LIMITS, nameCount, overMessage } from '../limits'

/*
┌─ tickets ───────────────────────────────────────
│  SaveViewDialog: name a saved view and choose who sees it (LAM-118)
├─ out ───────────────────────────────────────────
│      SaveViewDialog   <SaveViewDialog layout={…} onSave={({ name, is_shared }) => …} onCancel={…} />
*/
// Private is the default, as it is on the server (`is_shared` false): a view is
// yours until you say it is the team's.
type SaveViewDialogProps = {
    layout: 'list' | 'board'
    onSave: (view: { name: string; is_shared: boolean }) => void
    onCancel: () => void
}

export function SaveViewDialog(props: SaveViewDialogProps) {
    const [name, setName] = createSignal('')
    const [shared, setShared] = createSignal(false)
    const [touched, setTouched] = createSignal(false)

    const blank = () => name().trim() === ''
    const tooLong = () => overMessage('Name', nameCount(name()))
    const error = () => (touched() && blank() ? 'Give the view a name.' : tooLong())
    const invalid = () => blank() || codePoints(name().trim()) > LIMITS.name

    return (
        <Modal
            title={`Save ${props.layout} view`}
            consequence={
                shared()
                    ? 'Everyone on the team will see this view in their sidebar.'
                    : 'Only you will see this view.'
            }
            confirm="Save view"
            onConfirm={() => {
                setTouched(true)
                if (invalid()) return
                props.onSave({ name: name().trim(), is_shared: shared() })
            }}
            onCancel={props.onCancel}
        >
            <Input label="Name" value={name()} onInput={setName} error={error()} count={nameCount(name())} />
            <fieldset class="save-view__who">
                <legend class="t-body">Who can see it</legend>
                <label class="t-body" for="save-view-only-me">
                    <input
                        id="save-view-only-me"
                        type="radio"
                        name="save-view-who"
                        value="private"
                        checked={!shared()}
                        onChange={() => setShared(false)}
                    />{' '}
                    Only me
                </label>
                <label class="t-body" for="save-view-team">
                    <input
                        id="save-view-team"
                        type="radio"
                        name="save-view-who"
                        value="shared"
                        checked={shared()}
                        onChange={() => setShared(true)}
                    />{' '}
                    The team
                </label>
            </fieldset>
        </Modal>
    )
}
